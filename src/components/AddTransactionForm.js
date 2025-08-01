// AddTransactionForm.js

import React, { useContext, useState, useEffect } from 'react'; // Make sure useEffect is here
import { collection, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore'; // Make sure doc and updateDoc are here
import { AppContext } from '../App';

// Define the valid transaction types, now including their broad financial impact
const TRANSACTION_TYPES_OPTIONS = [
    { label: 'Capital Injection', value: 'Capital Injection', financialImpact: 'income' },
    { label: 'Capital Withdrawal', value: 'Capital Withdrawal', financialImpact: 'expense' },
    { label: 'Loan Disbursed (Outgoing)', value: 'Loan Disbursed', financialImpact: 'expense' }, // When *you* give a loan
    { label: 'Loan Repayment (Incoming)', value: 'Loan Repayment', financialImpact: 'income' }, // When *you* receive a repayment
    { label: 'General Expense', value: 'Expense', financialImpact: 'expense' },
    { label: 'Sale (Income)', value: 'Sale', financialImpact: 'income' },
    { label: 'Other Income', value: 'Other Income', financialImpact: 'income' },
    // You can add more specific types if needed, e.g., 'Feed Purchase', 'Broiler Sale' etc.
];

const EXPENSE_CATEGORIES = [
    'Feed', 'Medication', 'Utilities', 'Salaries', 'Rent', 'Repairs', 'Other Operating', 'Loan Interest', 'Debt Principal Payment',
];
const INCOME_CATEGORIES = [
    'Broiler Sales', 'Egg Sales', 'Other Product Sales', 'Grants', 'Subsidies', 'Investment Returns', 'Other Income Source', 'Loan Interest Received', 'Debt Principal Received',
];


const AddTransactionForm = ({ onTransactionSaved, onCancelEdit, initialData }) => {
    // Get userId, appId, and db from AppContext
    const { userId, appId, db } = useContext(AppContext);

    const [formData, setFormData] = useState({
        transactionType: initialData?.transactionType || '',
        category: initialData?.category || '',
        amount: initialData?.amount || 0,
        description: initialData?.description || '',
        relatedBatchId: initialData?.relatedBatchId || '',
        financialImpact: initialData?.financialImpact || '', // New field to store if it's income/expense
    });

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    // Effect to update formData if initialData changes (for editing)
    useEffect(() => {
        if (initialData) {
            setFormData({
                transactionType: initialData.transactionType || '',
                category: initialData.category || '',
                amount: initialData.amount || 0,
                description: initialData.description || '',
                relatedBatchId: initialData.relatedBatchId || '',
                financialImpact: initialData.financialImpact || '',
            });
        }
    }, [initialData]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prev) => {
            let updatedData = {
                ...prev,
                [name]: name === 'amount' ? parseFloat(value) : value,
            };

            // If transactionType changes, reset category and set financialImpact
            if (name === 'transactionType') {
                updatedData.category = ''; // Reset category when type changes
                const selectedType = TRANSACTION_TYPES_OPTIONS.find(opt => opt.value === value);
                updatedData.financialImpact = selectedType ? selectedType.financialImpact : '';
            }
            return updatedData;
        });
    };

    const getCategoriesForCurrentType = () => {
        if (formData.financialImpact === 'expense') {
            return EXPENSE_CATEGORIES;
        } else if (formData.financialImpact === 'income') {
            // For income types like Capital Injection, you might not need a sub-category,
            // or you can offer general income categories.
            // For now, let's offer INCOME_CATEGORIES for all 'income' impact types.
            return INCOME_CATEGORIES;
        }
        return [];
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Basic client-side validation
        if (!userId) {
            setError("You must be logged in to record transactions.");
            return;
        }
        if (!appId) {
            setError("Application ID missing. Cannot record transaction.");
            return;
        }
        // You might want to enhance this validation based on specific transaction types
        if (!formData.transactionType || formData.amount === undefined || formData.amount === null || formData.amount <= 0 || !formData.description.trim()) {
            setError("Please fill in Transaction Type, a positive Amount, and Description.");
            return;
        }

        setLoading(true); // Indicate loading state
        setError(null);   // Clear previous errors
        setSuccess(null); // Clear previous success messages

        let collectionName = ''; // This will hold the dynamic collection name
        let transactionToSave = {
            // Common fields for all transactions
            userId: userId, // Good practice to store the user ID with the transaction
            transactionType: formData.transactionType,
            financialImpact: formData.financialImpact, // Assuming formData includes this
            category: formData.category || 'Uncategorized', // Default if not provided
            amount: parseFloat(formData.amount), // Ensure amount is a number
            description: formData.description.trim(),
            timestamp: serverTimestamp(), // Use serverTimestamp for new documents
            // Conditional field: relatedBatchId
            ...(formData.relatedBatchId && { relatedBatchId: formData.relatedBatchId.trim() }),
        };

        // --- Determine the correct Firestore collection based on transactionType/category ---
        // This logic must strictly match your Firestore Security Rules' collection names.
        switch (formData.transactionType) {
            case 'Capital Injection':
            case 'Withdrawal':
                collectionName = 'financialTransactions';
                // No additional specific fields needed for these based on your previous form structure
                break;

            case 'Sales':
                collectionName = 'salesRecords';
                // Add sales-specific fields. Ensure these are in your formData
                transactionToSave = {
                    ...transactionToSave,
                    clientName: formData.clientName || 'N/A',
                    totalWeightSold: parseFloat(formData.totalWeightSold) || 0,
                    totalRevenue: parseFloat(formData.totalRevenue),
                    amountReceived: parseFloat(formData.amountReceived),
                    balanceDue: parseFloat(formData.balanceDue) || 0,
                };
                break;

            case 'Mortality':
                collectionName = 'mortalityRecords';
                // Add mortality-specific fields. Ensure these are in your formData
                transactionToSave = {
                    ...transactionToSave,
                    mortalityCount: parseInt(formData.mortalityCount, 10) || 0,
                    initialCount: parseInt(formData.initialCount, 10) || 0, // If you track initial count
                };
                break;

            case 'Feed Purchase':
                collectionName = 'feedRecords';
                // Add feed-specific fields. Ensure these are in your formData
                transactionToSave = {
                    ...transactionToSave,
                    supplyItemId: formData.selectedSupply || 'N/A', // ID of the feed item
                    quantityKg: parseFloat(formData.quantityKg) || 0,
                };
                break;

            case 'Other Expense':
                collectionName = 'expenses'; // This maps to the /expenses/ rules
                // Add any other specific fields for general expenses (e.g., supply item name, quantity purchased)
                transactionToSave = {
                    ...transactionToSave,
                    supplyItemName: formData.supplyItemName || null,
                    quantityPurchased: parseFloat(formData.quantityPurchased) || null
                };
                break;

            // Add cases for other transaction types (e.g., 'Health Record', 'Weight Record', etc.)
            // and map them to their corresponding collection names like 'healthRecords', 'weightRecords'

            default:
                // If the transaction type doesn't match any specific collection,
                // fall back to 'expenses' or 'financialTransactions' or throw an error.
                // For safety, let's explicitly flag it as an error if not matched.
                setError(`Invalid or unmapped transaction type: ${formData.transactionType}. Cannot save.`);
                setLoading(false);
                return;
        }

        // Prepare the Firestore reference for the specific collection
        const userSpecificCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/${collectionName}`);

        // --- Debugging Logs (Very Important!) ---
        console.log("Attempting to write to path:", `artifacts/${appId}/users/${userId}/${collectionName}`);
        console.log("Data to save:", transactionToSave);
        console.log("Database instance:", db);
        console.log("User ID:", userId);
        console.log("App ID:", appId);

        try {
            if (initialData && initialData.id) {
                // --- Editing existing transaction ---
                // The document reference must also use the correct collectionName
                const transactionRef = doc(db, `artifacts/${appId}/users/${userId}/${collectionName}`, initialData.id);
                // When editing, you might want to preserve the original serverTimestamp or replace it
                await updateDoc(transactionRef, { ...transactionToSave, timestamp: serverTimestamp() });
                setSuccess("Transaction updated successfully!");
            } else {
                // --- Adding a new transaction ---
                await addDoc(userSpecificCollectionRef, transactionToSave);
                setSuccess("Transaction recorded successfully!");
            }

            // --- Post-Save Actions ---
            // If you have a prop to call after a successful save (e.g., to refresh a list or close a modal)
            if (onTransactionSaved) {
                onTransactionSaved();
            } else {
                // Otherwise, reset the form for a new entry
                // This assumes setFormData exists and can reset your form's state
                setFormData({
                    transactionType: '',
                    category: '',
                    amount: 0,
                    description: '',
                    relatedBatchId: '',
                    financialImpact: '',
                    clientName: '',
                    totalWeightSold: '',
                    totalRevenue: '',
                    amountReceived: '',
                    balanceDue: '',
                    mortalityCount: '',
                    initialCount: '',
                    selectedSupply: '',
                    quantityKg: '',
                    supplyItemName: '',
                    quantityPurchased: '',
                    // Add any other form fields to reset
                });
            }
        } catch (err) {
            // --- Enhanced Error Logging and Notification ---
            console.error("Detailed Firestore error:", err); // Log the full error object for debugging
            setError(`Failed to record transaction: ${err.message || 'Unknown error'}. Please check your browser console for details.`);
        } finally {
            setLoading(false); // Always stop loading, regardless of success or failure
        }
    };

    return (
        <div style={formContainerStyle}>
            <h2>{initialData ? 'Edit Transaction' : 'Record New Financial Transaction'}</h2>
            <form onSubmit={handleSubmit}>
                <div style={inputGroupStyle}>
                    <label htmlFor="transactionType" style={labelStyle}>Transaction Type:</label>
                    <select
                        id="transactionType"
                        name="transactionType"
                        value={formData.transactionType}
                        onChange={handleChange}
                        required
                        style={inputStyle}
                    >
                        <option value="">-- Select a Type --</option>
                        {TRANSACTION_TYPES_OPTIONS.map((type) => (
                            <option key={type.value} value={type.value}>{type.label}</option>
                        ))}
                    </select>
                </div>

                {/* Conditionally render category based on transaction type's financial impact */}
                {getCategoriesForCurrentType().length > 0 && (
                    <div style={inputGroupStyle}>
                        <label htmlFor="category" style={labelStyle}>Category:</label>
                        <select
                            id="category"
                            name="category"
                            value={formData.category}
                            onChange={handleChange}
                            style={inputStyle}
                        >
                            <option value="">-- Select a Category (Optional) --</option>
                            {getCategoriesForCurrentType().map((cat) => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>
                    </div>
                )}

                <div style={inputGroupStyle}>
                    <label htmlFor="amount" style={labelStyle}>Amount:</label>
                    <input
                        type="number"
                        id="amount"
                        name="amount"
                        value={formData.amount}
                        onChange={handleChange}
                        required
                        min="0.01"
                        step="0.01"
                        style={inputStyle}
                    />
                </div>

                <div style={inputGroupStyle}>
                    <label htmlFor="description" style={labelStyle}>Description:</label>
                    <textarea
                        id="description"
                        name="description"
                        value={formData.description}
                        onChange={handleChange}
                        required
                        rows={3}
                        style={inputStyle}
                        placeholder="e.g., Purchased 50kg feed, Sold 10 broilers, Initial investment"
                    ></textarea>
                </div>

                <div style={inputGroupStyle}>
                    <label htmlFor="relatedBatchId" style={labelStyle}>Related Broiler Batch ID (Optional):</label>
                    <input
                        type="text"
                        id="relatedBatchId"
                        name="relatedBatchId"
                        value={formData.relatedBatchId}
                        onChange={handleChange}
                        style={inputStyle}
                        placeholder="e.g., BATCH_001"
                    />
                </div>

                <button type="submit" disabled={loading} style={buttonStyle}>
                    {loading ? (initialData ? 'Updating...' : 'Recording...') : (initialData ? 'Update Transaction' : 'Record Transaction')}
                </button>

                {initialData && (
                    <button
                        type="button"
                        onClick={onCancelEdit}
                        style={{ ...buttonStyle, backgroundColor: '#6c757d', marginLeft: '10px' }}
                    >
                        Cancel Edit
                    </button>
                )}


                {error && <p style={errorStyle}>{error}</p>}
                {success && <p style={successStyle}>{success}</p>}
            </form>
        </div>
    );
};

export default AddTransactionForm;

// Basic inline styles (assuming these are from your original code)
const formContainerStyle = {
    maxWidth: '600px',
    margin: '30px auto',
    padding: '25px',
    border: '1px solid #e0e0e0',
    borderRadius: '10px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    backgroundColor: '#ffffff',
};

const inputGroupStyle = {
    marginBottom: '20px',
};

const labelStyle = {
    display: 'block',
    marginBottom: '8px',
    fontWeight: 'bold',
    color: '#333',
};

const inputStyle = {
    width: '100%',
    padding: '12px',
    border: '1px solid #ccc',
    borderRadius: '6px',
    fontSize: '16px',
    boxSizing: 'border-box',
};

const buttonStyle = {
    width: '100%',
    padding: '12px 20px',
    backgroundColor: '#007bff',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '18px',
    cursor: 'pointer',
    transition: 'background-color 0.3s ease',
};

const errorStyle = {
    color: '#d32f2f',
    marginTop: '15px',
    backgroundColor: '#ffebee',
    padding: '10px',
    borderRadius: '5px',
    border: '1px solid #d32f2f',
};

const successStyle = {
    color: '#2e7d32',
    marginTop: '15px',
    backgroundColor: '#e8f5e9',
    padding: '10px',
    borderRadius: '5px',
    border: '1px solid #2e7d32',
};