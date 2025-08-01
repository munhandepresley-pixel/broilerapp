import React, { useContext, useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore'; // Import necessary Firestore functions
import { AppContext } from './App'; // CORRECTED: AppContext is correctly imported from './App'

// You might need to import your chart components here if you are using them
// import MortalityChart from './MortalityChart';
// import SalesChart from '././SalesChart';
// import FeedChart from './FeedChart';
// import FinancialChart from './FinancialChart';

// Removed db, userId, appId from props as they are sourced from AppContext
const ReportsTab = ({ batches, setNotificationMessage, setNotificationType }) => {
    const { db, userId, appId } = useContext(AppContext); // Destructuring from AppContext

    // --- DEBUGGING: Log Context values immediately ---
    console.log("ReportsTab - Context (db):", db);
    console.log("ReportsTab - Context (userId):", userId);
    console.log("ReportsTab - Context (appId):", appId);
    // ---------------------------------------------------

    const [mortalityRecords, setMortalityRecords] = useState([]);
    const [feedRecords, setFeedRecords] = useState([]);
    const [salesRecords, setSalesRecords] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [financingRecords, setFinancingRecords] = useState([]); // This will hold capital injections and withdrawals

    const [loadingReports, setLoadingReports] = useState(true);
    const [reportError, setReportError] = useState(null);

    // State for chart data (these aren't directly affected by new changes, but kept for context)
    const [batchMortalityData, setBatchMortalityData] = useState([]);
    const [batchSalesData, setBatchSalesData] = useState([]);
    const [batchFeedData, setBatchFeedData] = useState([]);
    const [batchFinancialData, setBatchFinancialData] = useState([]);

    // Fetch all necessary data for reports
    useEffect(() => {
        console.log("ReportsTab - useEffect: Running data fetch effect."); // DEBUGGING
        if (!db || !userId || !appId) {
            console.log("ReportsTab - useEffect: Missing db, userId, or appId. Bailing out.", { db, userId, appId }); // DEBUGGING
            setLoadingReports(false);
            setReportError("Database, User ID, or App ID not available.");
            return;
        }

        setLoadingReports(true);
        setReportError(null);

        const unsubscribes = [];
        const collectionsToFetch = ['mortalityRecords', 'feedRecords', 'salesRecords', 'expenses', 'financialTransactions'];
        let loadedCollectionsCount = 0; // To track when all collections have loaded their initial data

        try {
            collectionsToFetch.forEach(colName => {
                const collectionPath = `artifacts/${appId}/users/${userId}/${colName}`;
                const collectionRef = collection(db, collectionPath);

                let collectionQuery;
                // Temporarily remove orderBy from these collections to check if missing 'timestamp' is the issue
                if (['mortalityRecords', 'feedRecords', 'salesRecords', 'expenses'].includes(colName)) {
                    collectionQuery = query(collectionRef);
                } else {
                    // Keep orderBy for financialTransactions since it was already working
                    collectionQuery = query(collectionRef, orderBy('timestamp', 'desc'));
                }

                const unsubscribe = onSnapshot(collectionQuery, (snapshot) => {
                    const data = snapshot.docs.map(doc => {
                        const docData = doc.data();
                        return {
                            id: doc.id,
                            ...docData,
                            // Convert Firestore Timestamp to JavaScript Date object for easier use
                            date: docData.timestamp ? docData.timestamp.toDate() : null
                        };
                    });

                    switch (colName) {
                        case 'mortalityRecords':
                            setMortalityRecords(data);
                            console.log(`ReportsTab - Fetched ${colName}:`, data); // DEBUGGING
                            break;
                        case 'feedRecords':
                            setFeedRecords(data);
                            console.log(`ReportsTab - Fetched ${colName}:`, data); // DEBUGGING
                            break;
                        case 'salesRecords':
                            setSalesRecords(data);
                            console.log(`ReportsTab - Fetched ${colName}:`, data); // DEBUGGING
                            break;
                        case 'expenses':
                            setExpenses(data);
                            console.log(`ReportsTab - Fetched ${colName}:`, data); // DEBUGGING
                            break;
                        case 'financialTransactions':
                            setFinancingRecords(data); // This now includes 'date' as a JS Date
                            console.log(`ReportsTab - Fetched ${colName}:`, data); // DEBUGGING
                            break;
                        default:
                            break;
                    }

                    loadedCollectionsCount++;
                    if (loadedCollectionsCount === collectionsToFetch.length) {
                        setLoadingReports(false); // All initial data loaded
                        console.log("ReportsTab - All initial collections loaded."); // DEBUGGING
                    }
                }, (error) => {
                    console.error(`ReportsTab - Error fetching ${colName} for reports:`, error); // DEBUGGING
                    setNotificationMessage(`Failed to load ${colName}: ${error.message}`);
                    setNotificationType('error');
                    setReportError(prev => prev ? `${prev}; ${colName}: ${error.message}` : `Failed to load ${colName}: ${error.message}`);
                    setLoadingReports(false); // Set to false on error as well
                });
                unsubscribes.push(unsubscribe);
            });

        } catch (fetchError) {
            console.error("ReportsTab - Error setting up report listeners:", fetchError); // DEBUGGING
            setNotificationMessage(`Error setting up report listeners: ${fetchError.message}`);
            setNotificationType('error');
            setReportError(`Error setting up report listeners: ${fetchError.message}`);
            setLoadingReports(false);
        }

        return () => {
            console.log("ReportsTab - useEffect cleanup: Unsubscribing all listeners."); // DEBUGGING
            unsubscribes.forEach(unsub => unsub());
        };
    }, [db, userId, appId, setNotificationMessage, setNotificationType]);


    // Data aggregation for charts - now batch-based
    useEffect(() => {
        console.log("ReportsTab - useEffect: Aggregating batch data for charts."); // DEBUGGING
        const getBatchName = (batchId) => batches.find(b => b.id === batchId)?.name || `Batch ${batchId ? batchId.substring(0, 4) + '...' : 'Unknown'}`;

        const aggregateMortalityByBatch = () => {
            const batchData = {};
            mortalityRecords.forEach(record => {
                if (!batchData[record.batchId]) {
                    batchData[record.batchId] = { name: getBatchName(record.batchId), count: 0 };
                }
                batchData[record.batchId].count += (parseFloat(record.count) || 0);
            });
            return Object.values(batchData).sort((a, b) => a.name.localeCompare(b.name));
        };

        const aggregateSalesByBatch = () => {
            const batchData = {};
            salesRecords.forEach(record => {
                if (!batchData[record.batchId]) {
                    batchData[record.batchId] = { name: getBatchName(record.batchId), totalRevenue: 0 };
                }
                batchData[record.batchId].totalRevenue += (parseFloat(record.amountReceived) || 0); // Assuming amountReceived is direct sales
            });
            return Object.values(batchData).sort((a, b) => a.name.localeCompare(b.name));
        };

        const aggregateFeedByBatch = () => {
            const batchData = {};
            feedRecords.forEach(record => {
                if (!batchData[record.batchId]) {
                    batchData[record.batchId] = { name: getBatchName(record.batchId), quantityKg: 0 };
                }
                batchData[record.batchId].quantityKg += (parseFloat(record.quantityKg) || 0);
            });
            return Object.values(batchData).sort((a, b) => a.name.localeCompare(b.name));
        };

        const aggregateFinancialByBatch = () => {
            const batchData = {};
            batches.forEach(batch => {
                batchData[batch.id] = { name: batch.name, sales: 0, expenses: 0, net: 0 };
            });

            salesRecords.forEach(record => {
                if (batchData[record.batchId]) {
                    batchData[record.batchId].sales += (parseFloat(record.totalRevenue) || 0); // Use totalRevenue for financial charts
                }
            });

            // This aggregates batch-specific expenses, which is different from overall expenses
            expenses.forEach(record => {
                if (record.batchId && batchData[record.batchId]) {
                    batchData[record.batchId].expenses += (parseFloat(record.amount) || 0);
                }
            });

            // Note: financialTransactions (Capital Injection/Withdrawals) are usually not batch-specific
            // and are generally for overall farm financials, not tied to a single batch.
            // If you want to include them on a per-batch basis, you'd need to add a batchId field to them.

            return Object.values(batchData).map(data => ({
                ...data,
                net: data.sales - data.expenses
            })).sort((a, b) => a.name.localeCompare(b.name));
        };

        setBatchMortalityData(aggregateMortalityByBatch());
        setBatchSalesData(aggregateSalesByBatch());
        setBatchFeedData(aggregateFeedByBatch());
        setBatchFinancialData(aggregateFinancialByBatch());

    }, [mortalityRecords, feedRecords, salesRecords, expenses, batches]);


    // Helper function to get expenses based on batch and an array of category keywords
    const getExpensesByBatchAndCategory = (batchId, keywords) => {
        return expenses
            .filter(e => e.batchId === batchId && keywords.some(keyword => e.category?.toLowerCase().includes(keyword)))
            .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    };

    // Calculate total costs for a supply item
    const getSupplyItemCosts = () => {
        const costs = {};
        expenses.forEach(e => {
            // Check for supplyItemId and quantityPurchased in expenses that are related to supplies
            if (e.supplyItemId && e.quantityPurchased) {
                if (!costs[e.supplyItemId]) {
                    costs[e.supplyItemId] = { totalCost: 0, totalQuantity: 0 };
                }
                costs[e.supplyItemId].totalCost += (parseFloat(e.amount) || 0);
                costs[e.supplyItemId].totalQuantity += (parseFloat(e.quantityPurchased) || 0);
            }
        });
        return costs;
    };

    const supplyCosts = getSupplyItemCosts();

    // Calculate feed cost for a specific batch based on feed records and expense costs
    const getFeedCostForBatch = (batchId) => {
        const batchFeedRecords = feedRecords.filter(f => f.batchId === batchId);
        let totalCost = 0;

        batchFeedRecords.forEach(record => {
            if (record.supplyItemId && supplyCosts[record.supplyItemId]?.totalQuantity > 0) {
                const costPerKg = supplyCosts[record.supplyItemId].totalCost / supplyCosts[record.supplyItemId].totalQuantity;
                totalCost += costPerKg * (parseFloat(record.quantityKg) || 0);
            } else {
                // Fallback: If supplyItem costs aren't available, check if the feed record itself has a cost
                // This might indicate feed was directly recorded as an expense against the batch in feedRecords
                totalCost += (parseFloat(record.cost) || 0); // Assuming a 'cost' field might exist on feedRecords
            }
        });
        return totalCost;
    };

    // Calculate chick cost for a specific batch. This logic assumes chick costs are separate expenses.
    const getChickCostForBatch = (batchId) => {
        const chickKeywords = ['chick', 'kuiken', 'livestock', 'chicks', 'purchase', 'day-old'];
        return expenses
            .filter(e => e.batchId === batchId && chickKeywords.some(keyword => e.category?.toLowerCase().includes(keyword) || e.description?.toLowerCase().includes(keyword) || e.supplyItemName?.toLowerCase().includes(keyword)))
            .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    };

    // --- FINANCIAL CALCULATIONS (UPDATED WITH CORRECTED FIELD NAMES) ---
    const totalInitialBirds = batches.reduce((sum, batch) => sum + (parseFloat(batch.initialTotal) || 0), 0);
    const totalCurrentBirds = batches.reduce((sum, batch) => sum + (parseFloat(batch.currentCount) || 0), 0);
    const totalMortality = mortalityRecords.reduce((sum, record) => sum + (parseFloat(record.count) || 0), 0);
    const overallMortalityRate = totalInitialBirds > 0 ? (totalMortality / totalInitialBirds) * 100 : 0;
    const totalFeedConsumedOverall = feedRecords.reduce((sum, record) => sum + (parseFloat(record.quantityKg) || 0), 0);
    const totalSalesRevenueOverall = salesRecords.reduce((sum, record) => sum + (parseFloat(record.totalRevenue) || 0), 0); // Accrual basis
    const totalAmountReceivedOverall = salesRecords.reduce((sum, record) => sum + (parseFloat(record.amountReceived) || 0), 0); // Cash basis
    const totalBalanceDueOverall = salesRecords.reduce((sum, record) => sum + (parseFloat(record.balanceDue) || 0), 0);

    // Use the 'expenses' collection for overall farm financials (accrual basis)
    const totalExpensesOverall = expenses.reduce((sum, expense) => sum + (parseFloat(expense.amount) || 0), 0);

    // CORRECTED COGS CALCULATION: Sums only expenses with COGS-related keywords.
    const cogsKeywords = ['feed', 'voer', 'chick', 'kuiken', 'livestock', 'chicks', 'purchase', 'medication', 'vaccine']; // Added medication/vaccine if they are direct costs
    const totalCogsOverall = expenses.reduce((sum, expense) => {
        const categoryOrDesc = expense.supplyItemName || expense.category || expense.description || '';
        const isCogsKeyword = cogsKeywords.some(keyword => categoryOrDesc.toLowerCase().includes(keyword));
        if (isCogsKeyword) {
            return sum + (parseFloat(expense.amount) || 0);
        }
        return sum;
    }, 0);

    const otherOperatingExpensesForIncomeStatement = totalExpensesOverall - totalCogsOverall;

    const grossProfit = totalSalesRevenueOverall - totalCogsOverall;
    const netIncome = grossProfit - otherOperatingExpensesForIncomeStatement; // Operating Income before non-operating items

    // For Cashflow Statement - Operating Activities (Cash basis)
    const overallNetCashFromOperations = totalAmountReceivedOverall - totalExpensesOverall;

    // --- NEW: Calculate total Capital Injections and Withdrawals ---
    // *** IMPORTANT FIX HERE: 'record.transactionType' instead of 'record.type' ***
    const totalCapitalInjections = financingRecords
        .filter(record => record.transactionType === 'Capital Injection')
        .reduce((sum, record) => sum + (parseFloat(record.amount) || 0), 0);

    const totalWithdrawals = financingRecords
        .filter(record => record.transactionType === 'Withdrawal')
        .reduce((sum, record) => sum + (parseFloat(record.amount) || 0), 0);

    // Calculate Net Cash Flow from Financing Activities
    const netCashFromFinancingActivities = totalCapitalInjections - totalWithdrawals;

    // Calculate Net Increase/Decrease in Cash (Overall Cash Flow)
    // Operating Activities + Investing Activities (currently 0) + Financing Activities
    const netIncreaseDecreaseInCash = overallNetCashFromOperations + 0 + netCashFromFinancingActivities;


    // Prepare COGS expenses for display by category
    const cogsByCategory = expenses.reduce((acc, expense) => {
        const category = expense.supplyItemName || expense.category || expense.description || 'Other COGS';
        const isCogsKeyword = cogsKeywords.some(keyword => category.toLowerCase().includes(keyword));
        if (isCogsKeyword) {
            acc[category] = (acc[category] || 0) + (parseFloat(expense.amount) || 0);
        }
        return acc;
    }, {});

    // Prepare other expenses for display by category
    const expensesByCategory = expenses.reduce((acc, expense) => {
        const category = expense.supplyItemName || expense.category || expense.description || 'Other Operating Expense';
        const isCogsKeyword = cogsKeywords.some(keyword => category.toLowerCase().includes(keyword));
        if (!isCogsKeyword) {
            acc[category] = (acc[category] || 0) + (parseFloat(expense.amount) || 0);
        }
        return acc;
    }, {});

    // Prepare batch-specific data for the table
    const batchReports = batches.map(batch => {
        const batchMortality = mortalityRecords.filter(m => m.batchId === batch.id)
            .reduce((sum, m) => sum + (parseFloat(m.count) || 0), 0);

        const batchFeedConsumed = feedRecords.filter(f => f.batchId === batch.id)
            .reduce((sum, f) => sum + (parseFloat(f.quantityKg) || 0), 0);

        const batchSales = salesRecords.filter(s => s.batchId === batch.id);
        const batchTotalRevenue = batchSales.reduce((sum, s) => sum + (parseFloat(s.totalRevenue) || 0), 0); // Use totalRevenue from salesRecords

        // Use the new functions to get the costs
        const batchChickCost = getChickCostForBatch(batch.id);
        const batchFeedCost = getFeedCostForBatch(batch.id);

        // Calculate other batch-specific expenses (excluding COGS)
        const batchOtherExpenses = expenses.filter(e => e.batchId === batch.id && !cogsKeywords.some(keyword => (e.category?.toLowerCase().includes(keyword) || e.description?.toLowerCase().includes(keyword) || e.supplyItemName?.toLowerCase().includes(keyword))))
                                     .reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

        const batchTotalCosts = batchChickCost + batchFeedCost + batchOtherExpenses;
        const batchActualProfitLoss = batchTotalRevenue - batchTotalCosts;

        let fcr = 0;
        if (batchFeedConsumed > 0) {
            // FCR calculation should consider total weight produced/sold
            const totalWeightFromSales = batchSales.reduce((sum, s) => sum + (parseFloat(s.totalWeightSold) || 0), 0);
            const totalLiveWeight = (parseFloat(batch.currentCount) * (parseFloat(batch.currentWeight) || 0));

            // Use total weight sold if available and batch is closed/sold, otherwise use current live weight
            const relevantWeight = batch.status === 'Closed' ? totalWeightFromSales : totalLiveWeight;

            if (relevantWeight > 0) {
                fcr = batchFeedConsumed / relevantWeight;
            }
        }

        return {
            id: batch.id,
            name: batch.name,
            initialCount: parseFloat(batch.initialTotal) || 0,
            currentCount: parseFloat(batch.currentCount) || 0,
            mortality: batchMortality,
            mortalityRate: parseFloat(batch.initialTotal) > 0 ? (batchMortality / parseFloat(batch.initialTotal)) * 100 : 0,
            feedConsumed: batchFeedConsumed,
            averageWeight: parseFloat(batch.currentWeight) || 0,
            fcr: fcr.toFixed(2),
            totalSalesRevenue: batchTotalRevenue,
            amountReceived: batchSales.reduce((sum, s) => sum + (parseFloat(s.amountReceived) || 0), 0),
            estimatedProfitLoss: parseFloat(batch.estimatedProfitLoss) || 0,
            actualProfitLoss: batchActualProfitLoss,
            status: batch.status,
            birdsAge: batch.hatchDate ? Math.ceil(Math.abs(new Date() - new Date(batch.hatchDate)) / (1000 * 60 * 60 * 24)) : 'N/A'
        };
    });

    return (
        <div className="p-6 bg-gray-50 rounded-lg shadow-inner">
            <h2 className="text-2xl font-semibold text-gray-700 mb-4">Overall Farm Performance Summary</h2>
            {reportError && <p className="text-red-600 mb-4">{reportError}</p>}
            {loadingReports ? (
                <p className="text-gray-500 text-center py-8">Loading reports data...</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-800 mb-2">Bird Statistics</h3>
                        <p>Total Batches: <span className="font-medium">{batches.length}</span></p>
                        <p>Total Initial Birds: <span className="font-medium">{totalInitialBirds}</span></p>
                        <p>Total Current Birds: <span className="font-medium">{totalCurrentBirds}</span></p>
                        <p>Total Mortality: <span className="font-medium">{totalMortality}</span></p>
                        <p>Overall Mortality Rate: <span className="font-medium">{overallMortalityRate.toFixed(2)}%</span></p>
                    </div>
                    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-800 mb-2">Feed & Growth</h3>
                        <p>Total Feed Consumed: <span className="font-medium">{totalFeedConsumedOverall.toFixed(2)} kg</span></p>
                    </div>
                    <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                        <h3 className="text-lg font-semibold text-gray-800 mb-2">Financial Overview (Cash & Accrual)</h3>
                        <p>Total Sales Revenue (Accrual): <span className="font-medium">${totalSalesRevenueOverall.toFixed(2)}</span></p>
                        <p>Total Amount Received (Cash): <span className="font-medium">${totalAmountReceivedOverall.toFixed(2)}</span></p>
                        <p>Total Balance Due: <span className="font-medium">${totalBalanceDueOverall.toFixed(2)}</span></p>
                        <p>Total Expenses (Cash Outflows): <span className="font-medium">${totalExpensesOverall.toFixed(2)}</span></p>
                        {/* Overall Net P/L here is for general quick overview, detailed in cash flow */}
                        <p className={`text-lg font-bold ${overallNetCashFromOperations >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                            Overall Net P/L: ${overallNetCashFromOperations.toFixed(2)}
                        </p>
                        {/* New lines for overall injections and withdrawals */}
                        <p>Total Capital Injections: <span className="font-medium">${totalCapitalInjections.toFixed(2)}</span></p>
                        <p>Total Withdrawals: <span className="font-medium">${totalWithdrawals.toFixed(2)}</span></p>
                    </div>
                </div>
            )}

            <h2 className="text-2xl font-semibold text-gray-700 mb-4 mt-8">Batch Performance Details</h2>
            {loadingReports ? (
                <p className="text-gray-500 text-center py-8">Loading batch details...</p>
            ) : batches.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No batches to report on yet.</p>
            ) : (
                <div className="overflow-x-auto bg-white rounded-lg shadow-sm border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-100">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Batch Name</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Age (Days)</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Initial Count</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Current Count</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Mortality</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Mortality Rate (%)</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Feed Consumed (kg)</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Avg. Weight (kg)</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">FCR</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total Sales ($)</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actual P/L ($)</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {batchReports.map(batch => (
                                <tr key={batch.id}>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{batch.name}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{batch.status}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-right text-sm text-gray-500">{batch.birdsAge}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-right text-sm text-gray-500">{batch.initialCount}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-right text-sm text-gray-500">{batch.currentCount}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-right text-sm text-gray-500">{batch.mortality}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-right text-sm text-gray-500">{batch.mortalityRate.toFixed(2)}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-right text-sm text-gray-500">{batch.feedConsumed.toFixed(2)}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-right text-sm text-gray-500">{batch.averageWeight.toFixed(2)}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-right text-sm text-gray-500">{batch.fcr}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-right text-sm text-gray-500">${batch.totalSalesRevenue.toFixed(2)}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <span className={`${batch.actualProfitLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            ${batch.actualProfitLoss.toFixed(2)}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <div className="mt-8 p-6 bg-gray-50 rounded-lg shadow-inner">
                <h3 className="text-2xl font-semibold text-gray-700 mb-4">Cash Flow Statement</h3>
                {loadingReports ? (
                    <p className="text-gray-500 text-center py-8">Loading cash flow data...</p>
                ) : (
                    <div className="space-y-4 text-gray-800">
                        <div className="py-2">
                            <p className="font-semibold text-lg mb-2">Cash Flow from Operating Activities:</p>
                            <div className="ml-4 space-y-2">
                                <div className="flex justify-between">
                                    <p className="text-base">Cash Inflows from Sales:</p>
                                    <p className="text-base text-green-700">${totalAmountReceivedOverall.toFixed(2)}</p>
                                </div>
                                <div className="flex justify-between">
                                    <p className="text-base">Cash Outflows for Expenses:</p>
                                    <p className="text-base text-red-700">(${totalExpensesOverall.toFixed(2)})</p>
                                </div>
                            </div>
                            <div className="flex justify-between items-center pt-2 border-t border-gray-300 mt-2">
                                <p className="font-bold text-lg">Net Cash Flow from Operating Activities:</p>
                                <p className={`font-bold text-lg ${overallNetCashFromOperations >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                    ${overallNetCashFromOperations.toFixed(2)}
                                </p>
                            </div>
                        </div>

                        <div className="py-2 mt-6">
                            <p className="font-semibold text-lg mb-2">Cash Flow from Investing Activities:</p>
                            <div className="ml-4 space-y-1">
                                <p className="text-gray-500">Currently not tracked in detail (e.g., purchase/sale of assets).</p>
                                <div className="flex justify-between font-medium text-base">
                                    <p>Net Cash from Investing Activities:</p>
                                    <p>$0.00</p>
                                </div>
                            </div>
                        </div>

                        <div className="py-2 mt-6">
                            <p className="font-semibold text-lg mb-2">Cash Flow from Financing Activities:</p>
                            <div className="ml-4 space-y-1">
                                <div className="flex justify-between text-base">
                                    <p>Cash Inflows from Capital Injections:</p>
                                    <p className="text-green-700">${totalCapitalInjections.toFixed(2)}</p>
                                </div>
                                <div className="flex justify-between text-base">
                                    <p>Cash Outflows for Withdrawals:</p>
                                    <p className="text-red-700">(${totalWithdrawals.toFixed(2)})</p>
                                </div>
                                <p className="text-gray-500 text-sm">Other financing activities (e.g., loans) currently not tracked in detail.</p>
                                <div className="flex justify-between font-medium text-base border-t border-gray-300 pt-2 mt-2">
                                    <p>Net Cash from Financing Activities:</p>
                                    <p className={`font-medium ${netCashFromFinancingActivities >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                        ${netCashFromFinancingActivities.toFixed(2)}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-between items-center pt-2 border-t-2 border-gray-400 mt-6">
                            <p className="font-bold text-xl">Net Increase/Decrease in Cash:</p>
                            <p className={`font-bold text-xl ${
                                netIncreaseDecreaseInCash >= 0 ? 'text-green-700' : 'text-red-700'
                            }`}>
                                ${netIncreaseDecreaseInCash.toFixed(2)}
                            </p>
                        </div>

                        <p className="text-sm text-gray-600 mt-4">
                            *This cash flow statement focuses on operating activities, with a basic inclusion of owner contributions and withdrawals in financing.
                            Detailed investing and other financing activities require more specific data capture.
                        </p>
                    </div>
                )}
            </div>

            <div className="mt-8 p-6 bg-gray-50 rounded-lg shadow-inner">
                <h3 className="text-2xl font-semibold text-gray-700 mb-4">Income Statement (Accrual-Based)</h3>
                {loadingReports ? (
                    <p className="text-gray-500 text-center py-8">Loading income statement data...</p>
                ) : (
                    <div className="space-y-4 text-gray-800">
                        <div className="flex justify-between items-center py-2">
                            <p className="font-semibold text-lg">Revenue:</p>
                            <p className="font-semibold text-lg text-green-700">${totalSalesRevenueOverall.toFixed(2)}</p>
                        </div>

                        <div className="py-2">
                            <p className="font-semibold text-lg mb-2">Cost of Goods Sold (COGS):</p>
                            <div className="ml-4 space-y-1">
                                {Object.entries(cogsByCategory).length > 0 ? (
                                    Object.entries(cogsByCategory).map(([category, amount]) => (
                                        <div key={category} className="flex justify-between text-base">
                                            <p className="capitalize">{category}:</p>
                                            <p className="text-red-700">(${amount.toFixed(2)})</p>
                                        </div>
                                    ))
                                ) : (
                                    <p className="text-gray-500">No COGS expenses found.</p>
                                )}
                                <div className="flex justify-between font-medium text-base border-t border-gray-300 pt-2 mt-2">
                                    <p>Total COGS:</p>
                                    <p className="text-red-700">(${totalCogsOverall.toFixed(2)})</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-between items-center pt-2 border-t-2 border-gray-400">
                            <p className="font-bold text-xl">Gross Profit:</p>
                            <p className={`font-bold text-xl ${grossProfit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                ${grossProfit.toFixed(2)}
                            </p>
                        </div>

                        <div className="py-2">
                            <p className="font-semibold text-lg mb-2">Operating Expenses:</p>
                            <div className="ml-4 space-y-1">
                                {Object.entries(expensesByCategory).length > 0 ? (
                                    Object.entries(expensesByCategory).map(([category, amount]) => (
                                        <div key={category} className="flex justify-between text-base">
                                            <p className="capitalize">{category}:</p>
                                            <p className="text-red-700">(${amount.toFixed(2)})</p>
                                        </div>
                                    ))
                                ) : (
                                    <p className="text-gray-500">No other operating expenses.</p>
                                )}
                                <div className="flex justify-between font-medium text-base border-t border-gray-300 pt-2 mt-2">
                                    <p>Total Operating Expenses:</p>
                                    <p className="text-red-700">(${otherOperatingExpensesForIncomeStatement.toFixed(2)})</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-between items-center pt-2 border-t-2 border-gray-400">
                            <p className="font-bold text-xl">Operating Income:</p>
                            <p className={`font-bold text-xl ${netIncome >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                ${netIncome.toFixed(2)}
                            </p>
                        </div>

                        <div className="mt-6">
                            <p className="font-semibold text-lg">Non-Operating Income/Expenses:</p>
                            <div className="ml-4 space-y-1">
                                <p className="text-gray-500">Currently not tracked in detail (e.g., interest, taxes)</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReportsTab;