import React, { useState, useEffect, createContext, useContext, useMemo } from 'react';
import ReportsTab from './ReportsTab';
import AddTransactionForm from './components/AddTransactionForm'; // <--- THIS LINE
import WhatsAppSender from './WhatsAppSender';
import { initializeApp } from 'firebase/app';
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup,
    signInAnonymously,
    signInWithCustomToken
} from 'firebase/auth';
import {
    getFirestore,
    collection,
    addDoc,
    onSnapshot,
    query,
    where,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
    runTransaction,
    collectionGroup,
    orderBy
} from 'firebase/firestore';

// NEW: Import getFunctions and httpsCallable for client-side function calls
import { getFunctions, httpsCallable } from 'firebase/functions';

// Import Recharts components
// Ensure 'recharts' is installed in your project: npm install recharts
import {
    ResponsiveContainer,
    LineChart,
    CartesianGrid,
    XAxis,
    YAxis,
    Tooltip,
    Legend,
    Line,
    BarChart,
    Bar
} from 'recharts';


// Tailwind CSS CDN (ensure this is loaded in the HTML if not using a build process)
// <script src="https://cdn.tailwindcss.com"></script>

// src/App.js (near the top, after imports)
const STANDARD_BAG_SIZE_KG = 50; // Define bag size here
// Load Firebase configuration and other environment-dependent variables
// DIRECTLY ACCESSING PROCESS.ENV FOR THESE VARIABLES
const firebaseConfigString = process.env.REACT_APP_FIREBASE_CONFIG;
let firebaseConfig = null; // Initialize as null to clearly indicate missing config
if (firebaseConfigString) {
    try {
        firebaseConfig = JSON.parse(firebaseConfigString);
    } catch (e) {
        console.error("Error parsing Firebase config string:", e);
        // Keep firebaseConfig as null to trigger the appError state
    }
}

const appId = process.env.REACT_APP_APP_ID || 'default-app-id';
const initialAuthToken = process.env.REACT_APP_INITIAL_AUTH_TOKEN || '';


export const AppContext = createContext(null);

const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;

const App = () => {
    const [firebaseApp, setFirebaseApp] = useState(null);
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [currentUser, setCurrentUser] = useState(null);
    const [userRole, setUserRole] = useState(null);
    const [isApproved, setIsApproved] = useState(false);
    const [loadingApp, setLoadingApp] = useState(true);
    const [appError, setAppError] = useState(null);
    const [userName, setUserName] = useState(null);
    const [batches, setBatches] = useState([]); // State for batches, now managed higher up
    const [functions, setFunctions] = useState(null); // NEW: State for Firebase Functions instance

    // Effect for Firebase Initialization and Auth State Changes
    useEffect(() => {
        let unsubscribeAuth = () => {};

        // Added DEBUG console logs here
        // The console logs will still use process.env to display values.
        console.log("DEBUG ENVIRONMENT VARIABLE: REACT_APP_FIREBASE_CONFIG (raw string):", process.env.REACT_APP_FIREBASE_CONFIG);
        console.log("DEBUG ENVIRONMENT VARIABLE: REACT_APP_APP_ID (raw string):", process.env.REACT_APP_APP_ID);
        console.log("DEBUG ENVIRONMENT VARIABLE: REACT_APP_INITIAL_AUTH_TOKEN (raw string):", process.env.REACT_APP_INITIAL_AUTH_TOKEN);
        console.log("DEBUG ENVIRONMENT VARIABLE: Parsed firebaseConfig object:", firebaseConfig);
        console.log("DEBUG ENVIRONMENT VARIABLE: Final appId:", appId);
        console.log("DEBUG ENVIRONMENT VARIABLE: NODE_ENV (raw string):", process.env.NODE_ENV);
        console.log("DEBUG ENVIRONMENT VARIABLE: REACT_APP_HELLO (raw string):", process.env.REACT_APP_HELLO);
        console.log("DEBUG ENVIRONMENT VARIABLE: REACT_APP_TEST_NUMBER (raw string):", process.env.REACT_APP_TEST_NUMBER);


        if (!firebaseConfig || Object.keys(firebaseConfig).length === 0) {
            // Updated error message to reflect direct process.env access
            setAppError(`Firebase configuration is missing or invalid. Please ensure REACT_APP_FIREBASE_CONFIG is correctly set in your .env.production file (or .env.local for development).`);
            setLoadingApp(false);
            return;
        }

        try {
            const appInstance = initializeApp(firebaseConfig);
            const firestoreInstance = getFirestore(appInstance);
            const authInstance = getAuth(appInstance);
            const functionsInstance = getFunctions(appInstance, 'us-central1'); // NEW: Initialize functions

            setFirebaseApp(appInstance);
            setDb(firestoreInstance);
            setAuth(authInstance);
            setFunctions(functionsInstance); // NEW: Set functions instance in state

            // Attempt initial sign-in with custom token or anonymously
            const signInInitialUser = async () => {
                try {
                    if (initialAuthToken) { // Use the now-defined initialAuthToken
                        await signInWithCustomToken(authInstance, initialAuthToken);
                        console.log("Signed in with custom token.");
                    } else {
                        //await signInAnonymously(authInstance);
                        //console.log("Signed in anonymously (no custom token).");
                    }
                } catch (authSignInError) {
                    console.error("Initial Firebase sign-in error:", authSignInError);
                    // Do not set appError here, onAuthStateChanged will handle the final user state.
                    // This error might occur if the token is invalid, but onAuthStateChanged will then fire with null user.
                }
            };
            signInInitialUser(); // Call the async sign-in function

            unsubscribeAuth = onAuthStateChanged(authInstance, async (user) => {
                if (user) {
                    setCurrentUser(user);
                    // Ensure db is available before trying to fetch user doc
                    if (firestoreInstance) {
                        const userDocRef = doc(firestoreInstance, `artifacts/${appId}/users/${user.uid}`);
                        try {
                            const userDocSnap = await getDoc(userDocRef);
                            if (userDocSnap.exists()) {
                                const userData = userDocSnap.data();
                                setUserRole(userData.role);
                                setIsApproved(userData.isApproved);
                                setUserName(userData.name || user.email);
                                console.log(`User ${user.uid} signed in. Role: ${userData.role}, Approved: ${userData.isApproved}`);
                            } else {
                                console.warn("User document not found for authenticated user:", user.uid);
                                const defaultName = user.displayName || user.email;
                                await setDoc(userDocRef, {
                                    email: user.email,
                                    name: defaultName,
                                    role: 'stakeholder',
                                    isApproved: false,
                                    createdAt: serverTimestamp()
                                });
                                setUserRole('stakeholder');
                                setIsApproved(false);
                                setUserName(defaultName);
                                console.log("New user document created for:", user.email);
                            }
                        } catch (firestoreError) {
                            console.error("Error fetching/creating user role/approval:", firestoreError);
                            // Set appError for critical Firestore issues during user data load
                            setAppError(`Failed to load/create user data: ${firestoreError.message}`);
                        }
                    } else {
                        console.warn("Firestore instance not available when onAuthStateChanged fired with user.");
                        setAppError("Firestore not ready for user data.");
                    }
                } else {
                    setCurrentUser(null);
                    setUserRole(null);
                    setIsApproved(false);
                    setUserName(null);
                    setBatches([]); // Clear batches when no user
                    console.log("No user signed in. Displaying authentication screen.");
                    // Clear appError if it was set due to a previous user-specific data load failure
                    // and the user has now explicitly signed out or session ended.
                    setAppError(null);
                }
                setLoadingApp(false);
            });

        } catch (initError) {
            console.error("Firebase Initialization Error:", initError);
            setAppError(`Firebase initialization failed: ${initError.message}`);
            setLoadingApp(false);
        }

        return () => {
            unsubscribeAuth();
        };
    }, []); // Empty dependency array means this runs once on mount

    // Effect for Batches Data Listener (depends on authenticated user)
    useEffect(() => {
        let unsubscribeBatches = () => {};

        if (db && currentUser && isApproved) {
            setAppError(null); // Clear any previous batch errors when user logs in
            try {
                const batchesCollectionPath = `artifacts/${appId}/users/${currentUser.uid}/broilerBatches`;
                const batchesCollectionRef = collection(db, batchesCollectionPath); // Use 'collection' and the specific path
                const q = query(batchesCollectionRef, orderBy('hatchDate', 'desc'));

                unsubscribeBatches = onSnapshot(q, (snapshot) => {
                    const fetchedBatches = snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));

                    setBatches(fetchedBatches);

                }, (snapshotError) => {
                    console.error("Error fetching batches:", snapshotError);
                    // Only set appError if it's a persistent issue, not just due to sign-out timing
                    if (currentUser) { // Only show error if user is still supposed to be logged in
                        setAppError(`Failed to load batches: ${snapshotError.message}`);
                    } else {
                        // If user is null, this error is expected due to sign-out, don't show as app error
                        console.log("Batch listener error (expected after sign-out):", snapshotError.message);
                    }
                });
            } catch (batchListenerError) {
                console.error("Error setting up batches listener:", batchListenerError);
                setAppError(`Error setting up batches listener: ${batchListenerError.message}`);
            }
        } else {
            setBatches([]); // Clear batches immediately if no user or db
        }

        return () => {
            unsubscribeBatches(); // Unsubscribe when currentUser or db changes (e.g., on sign-out)
        };
    }, [db, currentUser, appId, isApproved]); // Depend on db and currentUser

    const contextValue = {
        app: firebaseApp,
        db,
        auth,
        currentUser,
        userId: currentUser?.uid,
        userRole,
        isApproved,
        appId,
        userName,
        setAppError,
        batches, // Now included in context
        // setBatches // setBatches is not directly used by children, so no need to expose
    };

    if (loadingApp) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <div className="text-2xl font-semibold text-gray-700">Loading Application...</div>
            </div>
        );
    }

    if (appError) {
        // Log the error to console when displaying the error page for easier debugging
        console.error("Application Error Displayed:", appError);
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-red-100 text-red-700 p-4 rounded-lg shadow-md">
                <p className="text-xl font-bold mb-4">Application Error</p>
                <p>{appError}</p>
                <button
                    onClick={() => window.location.reload()}
                    className="mt-4 bg-red-500 text-white py-2 px-4 rounded-md hover:bg-red-600"
                >
                    Reload Page
                </button>
            </div>
        );
    }

    return (
        <AppContext.Provider value={contextValue}>
            <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 font-inter p-4 sm:p-6 md:p-8">
                {currentUser ? (
                    isApproved ? (
                        <Dashboard />
                    ) : (
                        <ApprovalPendingScreen />
                    )
                ) : (
                    <AuthScreen />
                )}
                {/* NEW: Render the WhatsAppSender for testing */}
                {/* It's placed here for easy access, but you can move it to a more suitable location */}
                {functions && <WhatsAppSender functions={functions} />}
            </div>
        </AppContext.Provider>
    );
};


// --- AuthScreen Component ---
const AuthScreen = () => {
    const { auth, db, appId, setAppError } = useContext(AppContext);
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [name, setName] = useState('');
    const [message, setMessage] = useState('');
    const [loadingAuth, setLoadingAuth] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const handleAuth = async (e) => {
        e.preventDefault();
        setMessage('');
        setLoadingAuth(true);

        if (!auth || !db) {
            setAppError("Firebase services not available.");
            setLoadingAuth(false);
            return;
        }

        try {
            if (isLogin) {
                await signInWithEmailAndPassword(auth, email, password);
                setMessage("Logged in successfully!");
            } else {
                if (password !== confirmPassword) {
                    setMessage("Passwords do not match.");
                    setLoadingAuth(false);
                    return;
                }
                // Use the globally defined passwordRegex
                if (!passwordRegex.test(password)) {
                    setMessage("Password must be at least 8 characters, include uppercase, lowercase, digit, and special character.");
                    setLoadingAuth(false);
                    return;
                }

                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                const userDocRef = doc(db, `artifacts/${appId}/users/${user.uid}`);
                await setDoc(userDocRef, {
                    email: user.email,
                    name: name,
                    role: 'stakeholder',
                    isApproved: false,
                    createdAt: serverTimestamp()
                });
                setMessage("Account created! Waiting for admin approval.");
            }
        } catch (error) {
            console.error("Auth Error:", error);
            let errorMessage = "An unknown error occurred.";
            if (error.code) {
                switch (error.code) {
                    case 'auth/email-already-in-use': errorMessage = 'Email already in use.'; break;
                    case 'auth/invalid-email': errorMessage = 'Invalid email address.'; break;
                    case 'auth/operation-not-allowed': errorMessage = 'Email/password sign-in is not enabled.'; break;
                    case 'auth/weak-password': errorMessage = 'Password is too weak.'; break;
                    case 'auth/user-not-found': errorMessage = 'No user found with this email.'; break;
                    case 'auth/wrong-password': errorMessage = 'Incorrect password.'; break;
                    case 'auth/popup-closed-by-user': errorMessage = 'Authentication popup closed.'; break;
                    case 'auth/cancelled-popup-request': errorMessage = 'Authentication popup already open.'; break;
                    case 'auth/account-exists-with-different-credential': errorMessage = 'Account exists with different credentials. Try logging in with your previous method.'; break;
                    default: errorMessage = error.message;
                }
            }
            setMessage(errorMessage);
        } finally {
            setLoadingAuth(false);
        }
    };

    const handleGoogleSignIn = async () => {
        setMessage('');
        setLoadingAuth(true);
        if (!auth || !db) {
            setAppError("Firebase services not available.");
            setLoadingAuth(false);
            return;
        }

        try {
            const provider = new GoogleAuthProvider();
            const result = await signInWithPopup(auth, provider);
            const user = result.user;

            const userDocRef = doc(db, `artifacts/${appId}/users/${user.uid}`);
            const userDocSnap = await getDoc(userDocRef);

            if (!userDocSnap.exists()) {
                await setDoc(userDocRef, {
                    email: user.email,
                    name: user.displayName || user.email,
                    role: 'stakeholder',
                    isApproved: false,
                    createdAt: serverTimestamp()
                });
                setMessage("Google account linked! Waiting for admin approval.");
            } else {
                setMessage("Logged in with Google successfully!");
            }
        } catch (error) {
            console.error("Google Auth Error:", error);
            let errorMessage = "Google sign-in failed.";
            if (error.code) {
                switch (error.code) {
                    case 'auth/popup-closed-by-user': errorMessage = 'Google sign-in popup closed.'; break;
                    case 'auth/cancelled-popup-request': errorMessage = 'Google sign-in popup already open.'; break;
                    case 'auth/account-exists-with-different-credential': errorMessage = 'An account with this email already exists using a different sign-in method. Please sign in with your original method.'; break;
                    case 'auth/unauthorized-domain': errorMessage = 'Unauthorized domain. Please add your domain to the Firebase Console.'; break;
                    default: errorMessage = error.message;
                }
            }
            setMessage(errorMessage);
        } finally {
            setLoadingAuth(false);
        }
    };

    let messageClassName = "text-sm";
    if (message) {
        if (message.includes('success') || message.includes('created') || message.includes('linked')) {
            messageClassName += " text-green-600";
        } else {
            messageClassName += " text-red-600";
        }
    }

    const passwordToggleButtonIcon = showPassword ? (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
            <path fillRule="evenodd" d="M1.323 11.447C2.811 6.976 7.027 3.75 12 3.75c4.973 0 9.189 3.226 10.677 7.697a11.996 11.996 0 0 1-2.176 4.132 12.002 12.002 0 0 1-5.592 3.545 12.004 12.004 0 0 1-3.66 0 12.002 12.002 0 0 1-5.592-3.545 11.996 11.996 0 0 1-2.176-4.132Z" clipRule="evenodd" />
            <path fillRule="evenodd" d="M18.884 15.367c.224-.488.399-.988.555-1.5-.156-.512-.33-.999-.555-1.488A12.004 12.004 0 0 0 12 9.75c-2.51 0-4.847.655-6.884 1.885a11.95 11.95 0 0 0-.555 1.488c-.224.488-.399.989-.555 1.5-.156.512-.33.998-.555 1.487A12.004 12.004 0 0 0 12 18.75c2.51 0 4.847-.655 6.884-1.885a11.95 11.95 0 0 0 .555-1.488Z" clipRule="evenodd" />
        </svg>
    ) : (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M3.53 2.47a.75.75 0 0 0-1.06 1.06L3.848 5.3l1.85-1.85a.75.75 0 0 0-1.06-1.06L3.53 2.47ZM9.303 8.02l-1.89-1.89a.75.75 0 1 0-1.06 1.06l1.89 1.89a.75.75 0 0 0 1.06-1.06ZM2.47 21.53l1.06-1.06L5.3 18.152l1.85 1.85a.75.75 0 0 0 1.06-1.06L7.03 17.098l1.89-1.89a.75.75 0 1 0-1.06-1.06l-1.89 1.89-1.06-1.06a.75.75 0 0 0-1.06 1.06l1.06 1.06-1.85 1.85a.75.75 0 0 0 1.06 1.06l1.85-1.85ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
            <path fillRule="evenodd" d="M12 3.75c-4.973 0-9.189 3.226-10.677 7.697a11.996 11.996 0 0 0 2.176 4.132 12.002 12.002 0 0 0 5.592 3.545 12.004 12.004 0 0 0 3.66 0 12.002 12.002 0 0 0 5.592-3.545 11.996 11.996 0 0 0 2.176-4.132C21.189 6.976 16.973 3.75 12 3.75Zm0 2.25c-2.071 0-3.994.843-5.378 2.227a10.429 10.429 0 0 0-1.785 2.183 10.42 10.42 0 0 0-.584 1.092 10.429 10.429 0 0 0-.584 1.092c-.17.34-.322.682-.455 1.025-.133.344-.247.688-.342 1.036-.095.348-.17.695-.226 1.047-.056.351-.087.702-.087 1.056 0 .354.03.705.087 1.056.056.352.13.699.226 1.047.095.348.209.692.342 1.036.133.343.285.685.456 1.025.17.34.364.679.584 1.022.22.343.468.674.749.994.28.32.599.626.953.911.354.286.744-.549-1.169-.789C15.994 6.843 14.071 6 12 6Z" clipRule="evenodd" />
        </svg>
    );

    return (
        <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg p-6 md:p-8 mt-10">
            <h1 className="text-3xl font-bold text-gray-800 mb-6 text-center">
                {isLogin ? 'Sign In' : 'Sign Up'}
            </h1>
            <form onSubmit={handleAuth} className="space-y-4">
                <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input
                        type="email"
                        id="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                        required
                    />
                </div>
                {!isLogin && (
                    <div>
                        <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
                        <input
                            type="text"
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g., John Doe"
                            className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                            required
                        />
                    </div>
                )}
                <div className="relative">
                    <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                    <input
                        type={showPassword ? 'text' : 'password'}
                        id="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500 pr-10"
                        required
                    />
                    <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center pt-6 text-gray-500 hover:text-gray-700"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                        {passwordToggleButtonIcon}
                    </button>
                </div>
                {/* ADD THIS NEW BLOCK FOR CONFIRM PASSWORD */}
    {!isLogin && ( // This ensures it only shows during Sign Up
        <div className="relative">
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
            <input
                type={showPassword ? 'text' : 'password'}
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500 pr-10"
                required
            />
            {/* You can reuse the password toggle button if you want, but ensure its `pt-6` or vertical positioning matches for this new field */}
             <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center pt-6 text-gray-500 hover:text-gray-700"
                aria-label={showPassword ? "Hide password" : "Show password"}
            >
                {passwordToggleButtonIcon}
            </button>
        </div>
    )}
                {message ? (
                    <p className={messageClassName}>
                        {message}
                    </p>
                ) : null}
                <button
                    type="submit"
                    className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition duration-200 ease-in-out shadow-md"
                    disabled={loadingAuth}
                >
                    {loadingAuth ? 'Processing...' : (isLogin ? 'Sign In' : 'Sign Up')}
                </button>
            </form>
            <div className="mt-4 text-center">
                <p className="text-sm text-gray-600 mb-2">Or</p>
                <button
                    onClick={handleGoogleSignIn}
                    className="w-full flex items-center justify-center bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition duration-200 ease-in-out shadow-md"
                    disabled={loadingAuth}
                >
                    <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12.24 10.285V14.4h6.806c-.275 1.765-2.056 5.327-6.806 5.327-4.62 0-8.39-3.77-8.39-8.39s3.77-8.39 8.39-8.39c2.688 0 4.504 1.165 5.593 2.15l3.144-3.144C18.445 2.972 15.517 2 12.24 2 6.427 2 1.66 6.76 1.66 12.583s4.767 10.583 10.58 10.583c7.178 0 11.51-5.193 11.51-10.285 0-.78-.07-1.525-.203-2.242H12.24z" />
                    </svg>
                    {loadingAuth ? 'Signing in with Google...' : 'Sign in with Google'}
                </button>
            </div>
            <p className="mt-4 text-center text-sm text-gray-600">
                {isLogin ? "Don't have an account?" : "Already have an account?"}{' '}
                <button
                    onClick={() => setIsLogin(!isLogin)}
                    className="text-green-600 hover:underline font-medium"
                >
                    {isLogin ? 'Sign Up' : 'Sign In'}
                </button>
            </p>
        </div>
    );
};



// --- ApprovalPendingScreen Component ---
const ApprovalPendingScreen = () => {
    const { currentUser, auth, userName } = useContext(AppContext);

    const handleSignOut = async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Error signing out:", error);
        }
    };

    return (
        <div className="max-w-xl mx-auto bg-white rounded-xl shadow-lg p-6 md:p-8 mt-10 text-center">
            <h1 className="text-3xl font-bold text-gray-800 mb-4">Account Pending Approval</h1>
            <p className="text-gray-700 mb-6">
                Your account ({userName || currentUser?.email}) has been created successfully.
                Please wait for an administrator to approve your account before you can access the application.
            </p>
            <p className="text-sm text-gray-600 mb-8">
                Your User ID: <span className="font-mono bg-gray-100 px-2 py-1 rounded">{currentUser?.uid}</span>
            </p>
            <button
                onClick={handleSignOut}
                className="bg-red-500 text-white py-2 px-4 rounded-md hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition duration-200 ease-in-out shadow-md"
            >
                Sign Out
            </button>
        </div>
    );
};

// --- Dashboard Component ---
const Dashboard = () => {
    const { userId, userRole, auth, userName, batches, db, appId } = useContext(AppContext);
    const [activeTab, setActiveTab] = useState('batches');
    const [notificationMessage, setNotificationMessage] = useState(null);
    const [notificationType, setNotificationType] = useState(null);

    const handleSignOut = async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Error signing out:", error);
            // setAppError is available from AppContext if needed for global errors
        }
    };

    useEffect(() => {
        if (notificationMessage) {
            const timer = setTimeout(() => {
                setNotificationMessage(null);
                setNotificationType(null);
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [notificationMessage]);

    return (
        <div className="max-w-6xl mx-auto bg-white rounded-xl shadow-lg p-6 md:p-8">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl sm:text-4xl font-bold text-gray-800">
                    Fresh-Farm Dashboard
                </h1>
                <button
                    onClick={handleSignOut}
                    className="bg-red-500 text-white py-2 px-4 rounded-md hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition duration-200 ease-in-out shadow-md"
                >
                    Sign Out
                </button>
            </div>

            <p className="text-sm text-gray-600 mb-4 text-center">
                Logged in as: <span className="font-semibold bg-gray-100 px-2 py-1 rounded">{userName || userId}</span>
                <span className="ml-4">Role: <span className="font-semibold capitalize">{userRole}</span></span>
            </p>

            {notificationMessage && <NotificationMessage message={notificationMessage} type={notificationType} />}

            <div className="mb-8 border-b border-gray-200 overflow-x-auto">
                <nav className="-mb-px flex space-x-4 md:space-x-8" aria-label="Tabs">
                    <TabButton tabName="batches" currentTab={activeTab} setActiveTab={setActiveTab}>Batch Management</TabButton>
                    <TabButton tabName="mortality" currentTab={activeTab} setActiveTab={setActiveTab}>Mortality Tracking</TabButton>
                    <TabButton tabName="feed" currentTab={activeTab} setActiveTab={setActiveTab}>Feed Management</TabButton>
                    <TabButton tabName="sales" currentTab={activeTab} setActiveTab={setActiveTab}>Broiler Sales</TabButton>
                    <TabButton tabName="expenses" currentTab={activeTab} setActiveTab={setActiveTab}>Expense Tracking</TabButton>
                    <TabButton tabName="weights" currentTab={activeTab} setActiveTab={setActiveTab}>Weight Tracking</TabButton>
                    <TabButton tabName="supplies" currentTab={activeTab} setActiveTab={setActiveTab}>Supply Inventory</TabButton>
                    <TabButton tabName="health" currentTab={activeTab} setActiveTab={setActiveTab}>Health Management</TabButton>
                    <TabButton tabName="reports" currentTab={activeTab} setActiveTab={setActiveTab}>Reports</TabButton>
                    {/* Add a new tab for Financial Transactions / Recording */}
                    <TabButton tabName="recordTransaction" currentTab={activeTab} setActiveTab={setActiveTab}>Record Transaction</TabButton>
                    {userRole === 'admin' && (
                        <TabButton tabName="userManagement" currentTab={activeTab} setActiveTab={setActiveTab}>User Management</TabButton>
                    )}
                </nav>
            </div>

            {/* Existing Tab Content */}
            {activeTab === 'batches' && <BatchManagementTab batches={batches} userRole={userRole} setNotificationMessage={setNotificationMessage} setNotificationType={setNotificationType} />}
            {activeTab === 'userManagement' && userRole === 'admin' && <UserManagementTab />}
            {activeTab === 'mortality' && <MortalityTrackingTab batches={batches} setNotificationMessage={setNotificationMessage} setNotificationType={setNotificationType} />}
            {activeTab === 'feed' && <FeedManagementTab batches={batches} setNotificationMessage={setNotificationMessage} setNotificationType={setNotificationType} />}
            {activeTab === 'sales' && <BroilerSalesTab batches={batches} setNotificationMessage={setNotificationMessage} setNotificationType={setNotificationType} />}
            {activeTab === 'expenses' && <ExpenseTrackingTab batches={batches} setNotificationMessage={setNotificationMessage} setNotificationType={setNotificationType} />}
            {activeTab === 'weights' && <WeightTrackingTab batches={batches} setNotificationMessage={setNotificationMessage} setNotificationType={setNotificationType} />}
            {activeTab === 'supplies' && <SupplyInventoryTab setNotificationMessage={setNotificationMessage} setNotificationType={setNotificationType} />}
            {activeTab === 'health' && <HealthManagementTab batches={batches} setNotificationMessage={setNotificationMessage} setNotificationType={setNotificationType} />}
            {activeTab === 'reports' && <ReportsTab batches={batches} setNotificationMessage={setNotificationMessage} setNotificationType={setNotificationType} />}

            {/* NEW: Tab content for AddTransactionForm */}
            {activeTab === 'recordTransaction' && (
                <AddTransactionForm
                    userId={userId}
                    appId={appId}
                    db={db}
                />
            )}
        </div>
    );
};

// --- TabButton Component ---
const TabButton = ({ tabName, currentTab, setActiveTab, children }) => {
    const isActive = tabName === currentTab;
    return (
        <button
            onClick={() => setActiveTab(tabName)}
            className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm
                ${isActive
                    ? 'border-green-500 text-green-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } focus:outline-none transition duration-150 ease-in-out`}
        >
            {children}
        </button>
    );
};

// --- NotificationMessage Component ---
const NotificationMessage = ({ message, type }) => {
    const bgColor = type === 'success' ? 'bg-green-500' : 'bg-red-500';
    const textColor = 'text-white';

    return (
        <div className={`fixed bottom-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 ${bgColor} ${textColor}
                        transition-opacity duration-300 ease-out border-2 ${type === 'success' ? 'border-green-700' : 'border-red-700'}`}>
            <p className="font-semibold">{message}</p>
        </div>
    );
};

// --- BatchManagementTab Component ---
const BatchManagementTab = ({ batches, userRole, setNotificationMessage, setNotificationType }) => {
    const { db, userId, appId } = useContext(AppContext);
    const [batchName, setBatchName] = useState('');
    const [chickCount, setChickCount] = useState('');
    const [startDate, setStartDate] = useState('');
    const [chickPrice, setChickPrice] = useState('');
    const [breed, setBreed] = useState('');
    const [hatchDate, setHatchDate] = useState('');
    const [freeChickCount, setFreeChickCount] = useState('');
    const [proposedSellingPricePerBird, setProposedSellingPricePerBird] = useState(''); // NEW state
    const [estimatedFeedCost, setEstimatedFeedCost] = useState('');
    const [isAddBatchFormExpanded, setIsAddBatchFormExpanded] = useState(false);

    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [batchToEdit, setBatchToEdit] = useState(null);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [batchToDelete, setBatchToDelete] = useState(null);

    const calculateBirdAge = (hatchDateString) => {
        if (!hatchDateString) return 'N/A';
        const hatchDate = new Date(hatchDateString);
        const today = new Date();
        const diffTime = Math.abs(today - hatchDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return `${diffDays} days old`;
    };

    const handleAddBatch = async (e) => {
        e.preventDefault();
        if (!db || !userId) {
            setNotificationMessage("Firebase not initialized or user not authenticated.");
            setNotificationType('error');
            return;
        }
        if (!batchName || !chickCount || !startDate || !chickPrice || !breed || !proposedSellingPricePerBird || !estimatedFeedCost) {
            setNotificationMessage("Please fill in all required fields for the batch (including proposed selling price per bird and feed costs).");
            setNotificationType('error');
            return;
        }

        const parsedChickCount = parseInt(chickCount, 10);
        const parsedFreeChickCount = parseInt(freeChickCount || '0', 10);
        const totalChicks = parsedChickCount + parsedFreeChickCount;
        const parsedChickPrice = parseFloat(chickPrice);


        // Calculate the initial cost of purchasing the chicks
        const initialChickPurchaseCost = parsedChickPrice * parsedChickCount; // Uses the 'purchased' count

        // --- NEW PARSING & VALIDATION FOR PROPOSED SELLING PRICE ---
        const parsedProposedSellingPricePerBird = parseFloat(proposedSellingPricePerBird);
        if (isNaN(parsedProposedSellingPricePerBird) || parsedProposedSellingPricePerBird < 0) {
            setNotificationMessage("Please enter a valid non-negative number for proposed selling price per bird.");
            setNotificationType('error');
            return;
        }

        const parsedEstimatedFeedCost = parseFloat(estimatedFeedCost);

        // --- NEW CALCULATION FOR ESTIMATED SALES REVENUE ---
        // Calculate estimated sales revenue based on proposed price and initial total chicks, less 5%
        const calculatedEstimatedSalesRevenue = (totalChicks * parsedProposedSellingPricePerBird) * 0.95;

        // --- CORRECTED CALCULATION FOR INITIAL ESTIMATED PROFIT/LOSS ---
        // Profit/Loss = Estimated Sales Revenue - Initial Chick Purchase Cost - Estimated Feed Cost
        const initialEstimatedProfitLoss = calculatedEstimatedSalesRevenue - initialChickPurchaseCost - parsedEstimatedFeedCost;

            try {
                const batchesCollectionPath = `artifacts/${appId}/users/${userId}/broilerBatches`;
                await addDoc(collection(db, batchesCollectionPath), {
                    name: batchName,
                    breed: breed,
                    hatchDate: hatchDate || null,
                    purchasedChickCount: parsedChickCount,
                    freeChickCount: parsedFreeChickCount,
                    initialTotal: totalChicks,
                    currentCount: totalChicks,
                    chickPrice: parsedChickPrice,
                    purchaseOrderDate: startDate,
                    receivedCollectionDate: startDate,
                    status: 'Active',
                    createdAt: serverTimestamp(),
                    currentMortalityRate: 0,
                    proposedSellingPricePerBird: parseFloat(parsedProposedSellingPricePerBird.toFixed(2)), 
                    estimatedProfitLoss: parseFloat(initialEstimatedProfitLoss.toFixed(2)),
                    estimatedSalesRevenue: parseFloat(calculatedEstimatedSalesRevenue.toFixed(2)),
                    estimatedFeedCost: parsedEstimatedFeedCost,
                    feedConversionRatio: 0,
                    currentWeight: 0,
                    mortality: 0,
                    feedConsumed: 0
                });
                setBatchName('');
                setChickCount('');
                setStartDate('');
                setChickPrice('');
                setBreed('');
                setHatchDate('');
                setFreeChickCount('');
                setProposedSellingPricePerBird(''); 
                setEstimatedFeedCost('');
                setNotificationMessage("Batch added successfully!");
                setNotificationType('success');
            } catch (addError) {
            console.error("Error adding batch:", addError);
            setNotificationMessage(`Failed to add batch: ${addError.message}`);
            setNotificationType('error');
            }
    };

    const openEditModal = (batch) => {
        setBatchToEdit(batch);
        setIsEditModalOpen(true);
    };

    const handleSaveEditedBatch = async (batchId, updatedData) => {
        // We expect updatedData to now contain proposedSellingPricePerBird and calculated estimatedSalesRevenue
        try {
            const batchRef = doc(db, `artifacts/${appId}/users/${userId}/broilerBatches`, batchId);

            // Access the current batch data to get the currentCount for recalculation
            const currentBatch = batches.find(b => b.id === batchId);
            if (!currentBatch) {
                console.error("Batch not found for editing:", batchId);
                setNotificationMessage("Error: Batch not found for editing.");
                setNotificationType('error');
                return;
            }

            // --- RECALCULATE ESTIMATED PROFIT/LOSS BASED ON NEW LOGIC ---
            // Ensure numbers are parsed correctly from updatedData (already done in EditBatchModal, but good to be safe)
            const parsedProposedSellingPricePerBird = parseFloat(updatedData.proposedSellingPricePerBird);
            const parsedChickPrice = parseFloat(updatedData.chickPrice);
            const parsedPurchasedChickCount = parseInt(updatedData.purchasedChickCount, 10);
            const parsedEstimatedFeedCost = parseFloat(updatedData.estimatedFeedCost);
            const parsedCurrentCount = parseInt(updatedData.currentCount, 10); // Use updated currentCount

            // Calculate initial cost of purchased chicks
            const initialChickPurchaseCost = parsedChickPrice * parsedPurchasedChickCount;

            // Calculate estimated sales revenue based on the new proposed price and CURRENT count
            // Note: We use updatedData.currentCount as the base for sales revenue
            const recalculatedEstimatedSalesRevenue = (parsedCurrentCount * parsedProposedSellingPricePerBird) * 0.95;

            // Recalculate estimated profit/loss
            const recalculatedEstimatedProfitLoss = recalculatedEstimatedSalesRevenue - initialChickPurchaseCost - parsedEstimatedFeedCost;

            // --- UPDATE Firestore with the new fields and recalculated values ---
            await updateDoc(batchRef, {
                ...updatedData, // This will include proposedSellingPricePerBird and estimatedSalesRevenue (which is already calculated)
                estimatedSalesRevenue: parseFloat(recalculatedEstimatedSalesRevenue.toFixed(2)), // Ensure it's the newly recalculated value
                estimatedProfitLoss: parseFloat(recalculatedEstimatedProfitLoss.toFixed(2)),
                updatedAt: serverTimestamp()
            });

            setNotificationMessage("Batch updated successfully!");
            setNotificationType('success');
            setBatchToEdit(null); // Changed from setSelectedBatch
            setIsEditModalOpen(false); // Changed from setIsEditBatchModalOpen
        } catch (error) {
            console.error("Error updating batch:", error);
            setNotificationMessage(`Failed to update batch: ${error.message}`);
            setNotificationType('error');
        }
    };

    const openDeleteConfirm = (batch) => {
        setBatchToDelete(batch);
        setIsDeleteConfirmOpen(true);
    };

    const handleDeleteBatch = async () => {
        if (!db || !userId || !batchToDelete?.id) {
            setNotificationMessage("Firebase not initialized or batch ID missing for deletion.");
            setNotificationType('error');
            return;
        }
        try {
            const batchDocRef = doc(db, `artifacts/${appId}/users/${userId}/broilerBatches`, batchToDelete.id);
            await deleteDoc(batchDocRef);
            setIsDeleteConfirmOpen(false);
            setBatchToDelete(null);
            setNotificationMessage("Batch deleted successfully!");
            setNotificationType('success');
        } catch (deleteError) {
            console.error("Error deleting batch:", deleteError);
            setNotificationMessage(`Failed to delete batch: ${deleteError.message}`);
            setNotificationType('error');
        }
    };

    return (
        <div>
            {userRole === 'admin' && (
                <div className="mb-8 p-6 bg-gray-50 rounded-lg shadow-inner">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-2xl font-semibold text-gray-700">Add New Broiler Batch</h2>
                        <button
                            onClick={() => setIsAddBatchFormExpanded(!isAddBatchFormExpanded)}
                            className="p-2 rounded-full bg-gray-200 hover:bg-gray-300 transition duration-150"
                            aria-expanded={isAddBatchFormExpanded}
                            aria-controls="add-batch-form"
                        >
                            {isAddBatchFormExpanded ? (
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                                </svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                                </svg>
                            )}
                        </button>
                    </div>

                    {isAddBatchFormExpanded && (
                        <form onSubmit={handleAddBatch} className="grid grid-cols-1 md:grid-cols-3 gap-4" id="add-batch-form">
                            <div>
                                <label htmlFor="batchName" className="block text-sm font-medium text-gray-700 mb-1">Batch Name</label>
                                <input
                                    type="text"
                                    id="batchName"
                                    value={batchName}
                                    onChange={(e) => setBatchName(e.target.value)}
                                    placeholder="e.g., Batch A - Summer 2025"
                                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                    required
                                />
                            </div>
                            <div>
                                <label htmlFor="breed" className="block text-sm font-medium text-gray-700 mb-1">Breed</label>
                                <input
                                    type="text"
                                    id="breed"
                                    value={breed}
                                    onChange={(e) => setBreed(e.target.value)}
                                    placeholder="e.g., Cobb 500"
                                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                    required
                                />
                            </div>
                            <div>
                                <label htmlFor="chickCount" className="block text-sm font-medium text-gray-700 mb-1">Number of Chicks (Purchased)</label>
                                <input
                                    type="number"
                                    id="chickCount"
                                    value={chickCount}
                                    onChange={(e) => setChickCount(e.target.value)}
                                    placeholder="e.g., 500"
                                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                    min="0"
                                    required
                                />
                            </div>
                            <div>
                                <label htmlFor="freeChickCount" className="block text-sm font-medium text-gray-700 mb-1">Free Extra Chicks (Optional)</label>
                                <input
                                    type="number"
                                    id="freeChickCount"
                                    value={freeChickCount}
                                    onChange={(e) => setFreeChickCount(e.target.value)}
                                    placeholder="e.g., 10"
                                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                    min="0"
                                />
                            </div>
                            <div>
                                <label htmlFor="chickPrice" className="block text-sm font-medium text-gray-700 mb-1">Chick Price (per chick)</label>
                                <input
                                    type="number"
                                    id="chickPrice"
                                    value={chickPrice}
                                    onChange={(e) => setChickPrice(e.target.value)}
                                    placeholder="e.g., 0.50"
                                    step="0.01"
                                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                    min="0"
                                    required
                                />
                            </div>
                            <div>
                                <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-1">Purchase/Order Date</label>
                                <input
                                    type="date"
                                    id="startDate"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                    required
                                />
                            </div>
                            <div>
                                <label htmlFor="hatchDate" className="block text-sm font-medium text-gray-700 mb-1">Hatch Date (Optional)</label>
                                <input
                                    type="date"
                                    id="hatchDate"
                                    value={hatchDate}
                                    onChange={(e) => setHatchDate(e.target.value)}
                                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                />
                            </div>
                            <div>
                              <label htmlFor="proposedSellingPricePerBird" className="block text-sm font-medium text-gray-700 mb-1">Proposed Selling Price Per Bird ($)</label>
                                <input
                                    type="number"
                                    id="proposedSellingPricePerBird"
                                    value={proposedSellingPricePerBird}
                                    onChange={(e) => setProposedSellingPricePerBird(e.target.value)}
                                    step="0.01"
                                    className="w-full p-2 border border-gray-300 rounded-md"
                                    min="0"
                                    required
                                />
                            </div>
                            <div>
                                <label htmlFor="estimatedFeedCost" className="block text-sm font-medium text-gray-700 mb-1">Estimated Feed Cost ($)</label>
                                <input
                                    type="number"
                                    id="estimatedFeedCost"
                                    value={estimatedFeedCost}
                                    onChange={(e) => setEstimatedFeedCost(e.target.value)}
                                    placeholder="e.g., 300.00"
                                    step="0.01"
                                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                    min="0"
                                    required
                                />
                            </div>
                            <div className="md:col-span-3">
                                <button
                                    type="submit"
                                    className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition duration-200 ease-in-out shadow-md"
                                >
                                    Add Batch
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            )}

            <div>
                <h2 className="text-2xl font-semibold text-gray-700 mb-4">Your Broiler Batches</h2>
                {batches.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">No batches added yet. {userRole === 'admin' && 'Add your first batch above!'}</p>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {batches.map((batch) => {
                            const createdAtDate = batch.createdAt ? new Date(batch.createdAt.toDate()) : null;
                            const formattedCreatedAt = createdAtDate
                                ? `${createdAtDate.getFullYear()}/${(createdAtDate.getMonth() + 1).toString().padStart(2, '0')}/${createdAtDate.getDate().toString().padStart(2, '0')}`
                                : 'N/A';

                            const ageCalculationDate = batch.hatchDate || batch.purchaseOrderDate;
                            const birdsAge = calculateBirdAge(ageCalculationDate);

                            return (
                                <div key={batch.id} className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 hover:shadow-md transition-shadow duration-200">
                                    <h3 className="text-lg font-bold text-gray-800 mb-2">{batch.name}</h3>
                                    <p className="text-sm text-gray-600">
                                        <span className="font-semibold">Breed:</span> {batch.breed}
                                    </p>
                                    <p className="text-sm text-gray-600">
                                        <span className="font-semibold">Purchased Chicks:</span> {batch.purchasedChickCount}
                                    </p>
                                    <p className="text-sm text-gray-600">
                                        <span className="font-semibold">Free Chicks:</span> {batch.freeChickCount || 0}
                                    </p>
                                    <p className="text-sm text-gray-600">
                                        <span className="font-semibold">Initial Total:</span> {batch.initialTotal}
                                    </p>
                                    <p className="text-sm text-gray-600">
                                        <span className="font-semibold">Current Chicks:</span> {batch.currentCount}
                                    </p>
                                    <p className="text-sm text-gray-600">
                                        <span className="font-semibold">Chick Price:</span> ${batch.chickPrice.toFixed(2)}
                                    </p>
                                    <p className="text-sm text-gray-600">
                                        <span className="font-semibold">Purchase Date:</span> {batch.purchaseOrderDate}
                                    </p>
                                    {batch.hatchDate && (
                                        <p className="text-sm text-gray-600">
                                            <span className="font-semibold">Hatch Date:</span> {batch.hatchDate}
                                        </p>
                                    )}
                                    <p className="text-sm text-gray-600">
                                        <span className="font-semibold">Birds Age:</span> {birdsAge}
                                    </p>
                                    <p className="text-sm text-gray-600">
                                        <span className="font-semibold">Status:</span> {batch.status}
                                    </p>
                                    <p className="text-sm text-gray-600">
                                        <span className="font-semibold">Mortality Rate:</span> {batch.currentMortalityRate.toFixed(2)}%
                                    </p>
                                    <p className="text-sm text-gray-600">
                                        <span className="font-semibold">Est. Sales Revenue:</span> ${batch.estimatedSalesRevenue?.toFixed(2) || '0.00'}
                                    </p>
                                    <p className="text-sm text-gray-600">
                                        <span className="font-semibold">Est. Feed Cost:</span> ${batch.estimatedFeedCost?.toFixed(2) || '0.00'}
                                    </p>
                                    <p className="text-sm text-gray-600">
                                        <span className="font-semibold">Estimated P/L:</span> ${batch.estimatedProfitLoss?.toFixed(2) || '0.00'}
                                    </p>
                                    <p className="text-sm text-gray-600">
                                        <span className="font-semibold">FCR:</span> {batch.feedConversionRatio.toFixed(2)}
                                    </p>
                                    {batch.createdAt && (
                                        <p className="text-xs text-gray-400 mt-2">
                                            Added: {formattedCreatedAt}
                                        </p>
                                    )}
                                    {userRole === 'admin' && (
                                        <div className="mt-4 flex justify-end space-x-2">
                                            <button
                                                onClick={() => openEditModal(batch)}
                                                className="text-blue-600 hover:text-blue-800 text-sm px-3 py-1 rounded-md border border-blue-600 hover:border-blue-800 transition duration-150"
                                            >
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => openDeleteConfirm(batch)}
                                                className="text-red-600 hover:text-red-800 text-sm px-3 py-1 rounded-md border border-red-600 hover:border-red-800 transition duration-150"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {isEditModalOpen && (
                <EditBatchModal
                    batch={batchToEdit}
                    onClose={() => setIsEditModalOpen(false)}
                    onSave={handleSaveEditedBatch}
                />
            )}

            {isDeleteConfirmOpen && (
                <DeleteConfirmModal
                    batch={batchToDelete}
                    onClose={() => setIsDeleteConfirmOpen(false)}
                    onConfirm={handleDeleteBatch}
                />
            )}
        </div>
    );
};

// --- EditBatchModal Component ---
const EditBatchModal = ({ batch, onClose, onSave }) => {
    // Initialize all state variables from the 'batch' prop
    const [editedName, setEditedName] = useState(batch.name);
    const [editedBreed, setEditedBreed] = useState(batch.breed);
    const [editedPurchasedChickCount, setEditedPurchasedChickCount] = useState(batch.purchasedChickCount);
    const [editedFreeChickCount, setEditedFreeChickCount] = useState(batch.freeChickCount || 0);
    const [editedChickPrice, setEditedChickPrice] = useState(batch.chickPrice);
    const [editedPurchaseOrderDate, setEditedPurchaseOrderDate] = useState(batch.purchaseOrderDate);
    const [editedHatchDate, setEditedHatchDate] = useState(batch.hatchDate || '');
    const [editedCurrentCount, setEditedCurrentCount] = useState(batch.currentCount);

    // Calculate initial proposed selling price per bird from existing estimatedSalesRevenue
    // assuming currentCount is reliable and a 5% buffer was applied.
    const initialProposedSellingPrice =
        batch.estimatedSalesRevenue && batch.currentCount > 0
            ? (batch.estimatedSalesRevenue / (batch.currentCount * 0.95)).toFixed(2)
            : '';
    const [editedProposedSellingPricePerBird, setEditedProposedSellingPricePerBird] = useState(initialProposedSellingPrice);

    const [editedEstimatedFeedCost, setEditedEstimatedFeedCost] = useState(batch.estimatedFeedCost || '');
    const [errorMessage, setErrorMessage] = useState('');

    // Use useEffect to update state if the 'batch' prop changes (e.g., when opening for a new batch)
    useEffect(() => {
        if (batch) {
            setEditedName(batch.name);
            setEditedBreed(batch.breed);
            setEditedPurchasedChickCount(batch.purchasedChickCount);
            setEditedFreeChickCount(batch.freeChickCount || 0);
            setEditedChickPrice(batch.chickPrice);
            setEditedPurchaseOrderDate(batch.purchaseOrderDate);
            setEditedHatchDate(batch.hatchDate || '');
            setEditedCurrentCount(batch.currentCount);

            const reInitialProposedSellingPrice =
                batch.estimatedSalesRevenue && batch.currentCount > 0
                    ? (batch.estimatedSalesRevenue / (batch.currentCount * 0.95)).toFixed(2)
                    : '';
            setEditedProposedSellingPricePerBird(reInitialProposedSellingPrice);

            setEditedEstimatedFeedCost(batch.estimatedFeedCost || '');
            setErrorMessage(''); // Clear error message on batch change
        }
    }, [batch]);


    const handleSubmit = (e) => {
        e.preventDefault();
        setErrorMessage('');

        const parsedPurchasedChickCount = parseInt(editedPurchasedChickCount, 10);
        const parsedFreeChickCount = parseInt(editedFreeChickCount || '0', 10);
        const totalChicks = parsedPurchasedChickCount + parsedFreeChickCount;
        const parsedChickPrice = parseFloat(editedChickPrice);

        // --- NEW PARSING & VALIDATION FOR PROPOSED SELLING PRICE ---
        const parsedProposedSellingPricePerBird = parseFloat(editedProposedSellingPricePerBird);
        if (isNaN(parsedProposedSellingPricePerBird) || parsedProposedSellingPricePerBird < 0) {
            setErrorMessage("Please enter a valid non-negative number for proposed selling price per bird.");
            return;
        }

        const parsedEstimatedFeedCost = parseFloat(editedEstimatedFeedCost);

        // Validate Current Chick Count as well for the calculation
        const parsedCurrentCount = parseInt(editedCurrentCount, 10);
        if (isNaN(parsedCurrentCount) || parsedCurrentCount < 0) {
            setErrorMessage("Current Chicks count must be a valid non-negative number.");
            return;
        }

        // --- UPDATED MAIN VALIDATION CHECK ---
        if (!editedName || !editedBreed || isNaN(parsedPurchasedChickCount) || isNaN(parsedFreeChickCount) || !editedPurchaseOrderDate || isNaN(parsedChickPrice) || isNaN(parsedProposedSellingPricePerBird) || isNaN(parsedEstimatedFeedCost)) {
            setErrorMessage("Please fill all required fields correctly.");
            return;
        }

        // --- NEW CALCULATION FOR ESTIMATED SALES REVENUE ---
        // Calculate estimated sales revenue based on proposed price and CURRENT count, less 5%
        const calculatedEstimatedSalesRevenue = (parsedCurrentCount * parsedProposedSellingPricePerBird) * 0.95;

        const updatedData = {
            name: editedName,
            breed: editedBreed,
            purchasedChickCount: parsedPurchasedChickCount,
            freeChickCount: parsedFreeChickCount,
            initialTotal: totalChicks,
            currentCount: parsedCurrentCount, // Ensure currentCount is parsed
            chickPrice: parsedChickPrice,
            purchaseOrderDate: editedPurchaseOrderDate,
            hatchDate: editedHatchDate || null,
            // --- NEW/UPDATED FIELDS FOR THE PAYLOAD ---
            proposedSellingPricePerBird: parseFloat(parsedProposedSellingPricePerBird.toFixed(2)), // Send the proposed price
            estimatedSalesRevenue: parseFloat(calculatedEstimatedSalesRevenue.toFixed(2)), // Send the calculated revenue
            estimatedFeedCost: parsedEstimatedFeedCost,
        };
        onSave(batch.id, updatedData);
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md flex flex-col max-h-[90vh]">
                <h2 className="text-2xl font-bold text-gray-800 mb-4 flex-shrink-0">Edit Batch: {batch.name}</h2>
                {errorMessage && <p className="text-red-600 mb-4 flex-shrink-0">{errorMessage}</p>}
                <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto pr-2 flex-grow">
                    <div>
                        <label htmlFor="editName" className="block text-sm font-medium text-gray-700 mb-1">Batch Name</label>
                        <input
                            type="text"
                            id="editName"
                            value={editedName}
                            onChange={(e) => setEditedName(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editBreed" className="block text-sm font-medium text-gray-700 mb-1">Breed</label>
                        <input
                            type="text"
                            id="editBreed"
                            value={editedBreed}
                            onChange={(e) => setEditedBreed(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editPurchasedChickCount" className="block text-sm font-medium text-gray-700 mb-1">Purchased Chicks</label>
                        <input
                            type="number"
                            id="editPurchasedChickCount"
                            value={editedPurchasedChickCount}
                            onChange={(e) => setEditedPurchasedChickCount(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            min="0"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editFreeChickCount" className="block text-sm font-medium text-gray-700 mb-1">Free Extra Chicks</label>
                        <input
                            type="number"
                            id="editFreeChickCount"
                            value={editedFreeChickCount}
                            onChange={(e) => setEditedFreeChickCount(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            min="0"
                        />
                    </div>
                    <div>
                        <label htmlFor="editCurrentCount" className="block text-sm font-medium text-gray-700 mb-1">Current Chicks</label>
                        <input
                            type="number"
                            id="editCurrentCount"
                            value={editedCurrentCount}
                            onChange={(e) => setEditedCurrentCount(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            min="0"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editChickPrice" className="block text-sm font-medium text-gray-700 mb-1">Chick Price</label>
                        <input
                            type="number"
                            id="editChickPrice"
                            value={editedChickPrice}
                            onChange={(e) => setEditedChickPrice(e.target.value)}
                            step="0.01"
                            className="w-full p-2 border border-gray-300 rounded-md"
                            min="0"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editPurchaseOrderDate" className="block text-sm font-medium text-gray-700 mb-1">Purchase Date</label>
                        <input
                            type="date"
                            id="editPurchaseOrderDate"
                            value={editedPurchaseOrderDate}
                            onChange={(e) => setEditedPurchaseOrderDate(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editHatchDate" className="block text-sm font-medium text-gray-700 mb-1">Hatch Date (Optional)</label>
                        <input
                            type="date"
                            id="editHatchDate"
                            value={editedHatchDate}
                            onChange={(e) => setEditedHatchDate(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                        />
                    </div>
                    {/* THIS IS THE CORRECTED INPUT FIELD FOR PROPOSED SELLING PRICE */}
                    <div>
                        <label htmlFor="editProposedSellingPricePerBird" className="block text-sm font-medium text-gray-700 mb-1">Proposed Selling Price Per Bird ($)</label>
                        <input
                            type="number"
                            id="editProposedSellingPricePerBird"
                            value={editedProposedSellingPricePerBird}
                            onChange={(e) => setEditedProposedSellingPricePerBird(e.target.value)}
                            step="0.01"
                            className="w-full p-2 border border-gray-300 rounded-md"
                            min="0"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editEstimatedFeedCost" className="block text-sm font-medium text-gray-700 mb-1">Estimated Feed Cost ($)</label>
                        <input
                            type="number"
                            id="editEstimatedFeedCost"
                            value={editedEstimatedFeedCost}
                            onChange={(e) => setEditedEstimatedFeedCost(e.target.value)}
                            step="0.01"
                            className="w-full p-2 border border-gray-300 rounded-md"
                            min="0"
                            required
                        />
                    </div>
                </form>
                <div className="flex justify-end space-x-3 mt-6 flex-shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-150"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        onClick={handleSubmit}
                        className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition duration-150"
                    >
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- DeleteConfirmModal Component ---
const DeleteConfirmModal = ({ batch, onClose, onConfirm }) => {
    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm text-center">
                <h2 className="text-xl font-bold text-gray-800 mb-4">Confirm Deletion</h2>
                <p className="text-gray-700 mb-6">
                    Are you sure you want to delete the batch "<span className="font-semibold">{batch?.name}</span>"?
                    This action cannot be undone.
                </p>
                <div className="flex justify-center space-x-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-150"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition duration-150"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- UserManagementTab Component ---
const UserManagementTab = () => {
    const { db, userId, appId, currentUser, setNotificationMessage, setNotificationType } = useContext(AppContext);
    const [users, setUsers] = useState([]);
    const [loadingUsers, setLoadingUsers] = useState(true);
    const [usersError, setUsersError] = useState(null);

    useEffect(() => {
        if (!db || !userId) return;

        setLoadingUsers(true);
        setUsersError(null);

        try {
            const usersCollectionPath = `artifacts/${appId}/users`;
            const usersCollectionRef = collection(db, usersCollectionPath);
            console.log("Firestore Path being requested for users:", usersCollectionPath);

            const unsubscribe = onSnapshot(usersCollectionRef, (snapshot) => {
                const fetchedUsers = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                // Filter out the current user from the list for display purposes,
                // or handle it specifically if you want them to see themselves.
                // For this tab, it's common to manage others.
                setUsers(fetchedUsers);
                setLoadingUsers(false);
            }, (snapshotError) => {
                console.error("Error fetching users:", snapshotError);
                setUsersError(`Failed to load users: ${snapshotError.message}`);
                setLoadingUsers(false);
            });

            return () => unsubscribe();
        } catch (fetchError) {
            console.error("Error setting up users listener:", fetchError);
            setUsersError(`Error setting up users listener: ${fetchError.message}`);
            setLoadingUsers(false);
        }
    }, [db, userId, appId]);

    const handleToggleApproval = async (userToUpdate) => {
        if (!db || !userId) {
            setNotificationMessage("Firebase not initialized or user not authenticated.");
            setNotificationType('error');
            return;
        }
        if (userToUpdate.id === currentUser.uid) {
            setNotificationMessage("You cannot change your own approval status from here.");
            setNotificationType('error');
            return;
        }

        try {
            const userDocRef = doc(db, `artifacts/${appId}/users`, userToUpdate.id);
            await updateDoc(userDocRef, {
                isApproved: !userToUpdate.isApproved,
                updatedAt: serverTimestamp()
            });
            setNotificationMessage(`User ${userToUpdate.email} approval toggled to ${!userToUpdate.isApproved ? 'Approved' : 'Pending'}.`);
            setNotificationType('success');
        } catch (error) {
            console.error("Error toggling user approval:", error);
            setNotificationMessage(`Failed to toggle approval for ${userToUpdate.email}: ${error.message}`);
            setNotificationType('error');
        }
    };

    const handleChangeRole = async (userToUpdate, newRole) => {
        if (!db || !userId) {
            setNotificationMessage("Firebase not initialized or user not authenticated.");
            setNotificationType('error');
            return;
        }
        if (userToUpdate.id === currentUser.uid) {
            setNotificationMessage("You cannot change your own role from here.");
            setNotificationType('error');
            return;
        }

        try {
            const userDocRef = doc(db, `artifacts/${appId}/users`, userToUpdate.id);
            await updateDoc(userDocRef, {
                role: newRole,
                updatedAt: serverTimestamp()
            });
            setNotificationMessage(`User ${userToUpdate.email} role changed to ${newRole}.`);
            setNotificationType('success');
        } catch (error) {
            console.error("Error changing user role:", error);
            setNotificationMessage(`Failed to change role for ${userToUpdate.email}: ${error.message}`);
            setNotificationType('error');
        }
    };

    const handleDeleteUser = async (userToDelete) => {
        if (!db || !userId) {
            setNotificationMessage("Firebase not initialized or user not authenticated.");
            setNotificationType('error');
            return;
        }
        if (userToDelete.id === currentUser.uid) {
            setNotificationMessage("You cannot delete your own account from here.");
            setNotificationType('error');
            return;
        }

        // In a real app, you might want a confirmation modal here
        // if (!window.confirm(`Are you sure you want to delete user ${userToDelete.email}? This action is irreversible.`)) {
        //     return;
        // }

        try {
            const userDocRef = doc(db, `artifacts/${appId}/users`, userToDelete.id);
            await deleteDoc(userDocRef);
            setNotificationMessage(`User ${userToDelete.email} deleted successfully.`);
            setNotificationType('success');
        } catch (error) {
            console.error("Error deleting user:", error);
            setNotificationMessage(`Failed to delete user ${userToDelete.email}: ${error.message}`);
            setNotificationType('error');
        }
    };

    return (
        <div className="p-6 bg-gray-50 rounded-lg shadow-inner">
            <h2 className="text-2xl font-semibold text-gray-700 mb-4">User Management</h2>
            {usersError && <p className="text-red-600 mb-4">{usersError}</p>}
            {loadingUsers ? (
                <p className="text-gray-500 text-center py-8">Loading users...</p>
            ) : users.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No users registered yet.</p>
            ) : (
                <div className="overflow-x-auto bg-white rounded-lg shadow-sm border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-100">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Full Name</th> {/* New Column */}
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Approved</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {users.map(user => (
                                <tr key={user.id}>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{user.name || 'N/A'}</td> {/* Display Fullname */}
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{user.email}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">{user.role}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">{user.isApproved ? 'Yes' : 'No'}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                                        <div className="flex space-x-2">
                                            <button
                                                onClick={() => handleToggleApproval(user)}
                                                className={`px-3 py-1 rounded-md text-white text-xs ${user.isApproved ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-green-600 hover:bg-green-700'}`}
                                                disabled={user.id === currentUser.uid} // Cannot approve/disapprove self
                                            >
                                                {user.isApproved ? 'Disapprove' : 'Approve'}
                                            </button>
                                            {user.role === 'admin' ? (
                                                <button
                                                    onClick={() => handleChangeRole(user, 'stakeholder')}
                                                    className="px-3 py-1 rounded-md bg-purple-500 text-white text-xs hover:bg-purple-600"
                                                    disabled={user.id === currentUser.uid} // Cannot change own role
                                                >
                                                    Demote
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => handleChangeRole(user, 'admin')}
                                                    className="px-3 py-1 rounded-md bg-indigo-600 text-white text-xs hover:bg-indigo-700"
                                                    disabled={user.id === currentUser.uid} // Cannot change own role
                                                >
                                                    Promote
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleDeleteUser(user)}
                                                className="px-3 py-1 rounded-md bg-red-600 text-white text-xs hover:bg-red-700"
                                                disabled={user.id === currentUser.uid} // Cannot delete self
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};


// --- MortalityTrackingTab Component ---
const MortalityTrackingTab = ({ batches, setNotificationMessage, setNotificationType }) => {
    const { db, userId, appId } = useContext(AppContext);
    const [selectedBatchId, setSelectedBatchId] = useState('');
    const [mortalityDate, setMortalityDate] = useState('');
    const [mortalityCount, setMortalityCount] = useState('');
    const [reason, setReason] = useState('');
    const [notes, setNotes] = useState('');

    const [mortalityRecords, setMortalityRecords] = useState([]);
    const [loadingMortality, setLoadingMortality] = useState(true);
    const [mortalityError, setMortalityError] = useState(null);
    const [isRecordMortalityFormExpanded, setIsRecordMortalityFormExpanded] = useState(false);

    const [isEditMortalityModalOpen, setIsEditMortalityModalOpen] = useState(false);
    const [mortalityRecordToEdit, setMortalityRecordToEdit] = useState(null);
    const [isDeleteMortalityConfirmOpen, setIsDeleteMortalityConfirmOpen] = useState(false);
    const [mortalityRecordToDelete, setMortalityRecordToDelete] = useState(null);

    useEffect(() => {
        if (!db || !userId) return;

        setLoadingMortality(true);
        setMortalityError(null);

        try {
            const mortalityCollectionPath = `artifacts/${appId}/users/${userId}/mortalityRecords`;
            const mortalityCollectionRef = collection(db, mortalityCollectionPath);

            const unsubscribe = onSnapshot(mortalityCollectionRef, (snapshot) => {
                const fetchedRecords = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                const sortedRecords = [...fetchedRecords].sort((a, b) => {
                    const dateA = a.date ? new Date(a.date) : new Date(0);
                    const dateB = b.date ? new Date(b.date) : new Date(0);
                    return dateB.getTime() - dateA.getTime();
                });
                setMortalityRecords(sortedRecords);
                setLoadingMortality(false);
            }, (snapshotError) => {
                console.error("Error fetching mortality records:", snapshotError);
                setMortalityError(`Failed to load mortality records: ${snapshotError.message}`);
                setLoadingMortality(false);
            });

            return () => unsubscribe();
        } catch (fetchError) {
            console.error("Error setting up mortality listener:", fetchError);
            setMortalityError(`Error setting up mortality listener: ${fetchError.message}`);
            setLoadingMortality(false);
        }
    }, [db, userId, appId]);

    const handleAddMortality = async (e) => {
        e.preventDefault();
        if (!db || !userId) {
            setNotificationMessage("Firebase not initialized or user not authenticated.");
            setNotificationType('error');
            return;
        }
        if (!selectedBatchId || !mortalityDate || !mortalityCount) {
            setNotificationMessage("Please select a batch, date, and count.");
            setNotificationType('error');
            return;
        }

        const parsedMortalityCount = parseInt(mortalityCount, 10);
        if (isNaN(parsedMortalityCount) || parsedMortalityCount <= 0) {
            setNotificationMessage("Please enter a valid positive number for mortality count.");
            setNotificationType('error');
            return;
        }

        // IMPORTANT: For transaction, we should NOT rely on 'batches' state directly for the 'selectedBatch'.
        // We need to read the *latest* batch data inside the transaction to ensure atomicity.
        // The pre-check for 'parsedMortalityCount > selectedBatch.currentCount' will be moved INSIDE the transaction.
        // So, remove this block for pre-validation against the local 'batches' state:
        /*
        const selectedBatch = batches.find(b => b.id === selectedBatchId);
        if (!selectedBatch) {
            setNotificationMessage("Selected batch not found.");
            setNotificationType('error');
            return;
        }
        if (parsedMortalityCount > selectedBatch.currentCount) {
            setNotificationMessage("Mortality count cannot exceed current live bird count in the batch.");
            setNotificationType('error');
            return;
        }
        */

        const batchDocRef = doc(db, `artifacts/${appId}/users/${userId}/broilerBatches`, selectedBatchId);
        // Note: Your mortality records are in a separate collection, which is fine.
        // This collection path should be consistent with where you're storing them.
        const mortalityRecordsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/mortalityRecords`);


        try {
            // --- START OF MODIFICATIONS ---
            // Wrap the entire update logic in a Firestore transaction
            await runTransaction(db, async (transaction) => {
                // 1. Read the LATEST batch data within the transaction
                const batchDoc = await transaction.get(batchDocRef);

                if (!batchDoc.exists()) {
                    throw new Error("Selected batch not found or no longer exists."); // Throw an error that will be caught below
                }

                const batchData = batchDoc.data();

                // 1a. Re-validate mortality count against the LATEST currentCount
                const currentCountBeforeMortality = batchData.currentCount || 0; // Use data from the transaction read
                if (parsedMortalityCount > currentCountBeforeMortality) {
                    throw new Error("Mortality count cannot exceed current live bird count in the batch. Please refresh.");
                }

                // 2. Calculate updated batch metrics
                const newCurrentCount = currentCountBeforeMortality - parsedMortalityCount;
                const newTotalMortality = (batchData.totalMortality || 0) + parsedMortalityCount;

                // Calculate new mortality rate
                let newMortalityRate = 0;
                if (batchData.initialTotal && batchData.initialTotal > 0) {
                    newMortalityRate = (newTotalMortality / batchData.initialTotal) * 100;
                }

                // 3. Retrieve financial-related data from the batch for recalculation
                const proposedSellingPricePerBird = batchData.proposedSellingPricePerBird || 0;
                const chickPrice = batchData.chickPrice || 0;
                const purchasedChickCount = batchData.purchasedChickCount || 0;
                const estimatedFeedCost = batchData.estimatedFeedCost || 0;

                // 4. Recalculate Estimated Sales Revenue
                // This is based on the *new* currentCount (newLiveBirds)
                // and the proposed selling price per bird stored in the batch.
                // Apply the 5% reduction factor (0.95) as per your existing logic.
                const newEstimatedSalesRevenue = (newCurrentCount * proposedSellingPricePerBird) * 0.95;

                // 5. Recalculate Estimated Profit/Loss
                // This needs initial purchase cost and estimated feed cost
                const initialChickPurchaseCost = chickPrice * purchasedChickCount;
                const newEstimatedProfitLoss = newEstimatedSalesRevenue - initialChickPurchaseCost - estimatedFeedCost;


                // 6. Update the batch document within the transaction
                transaction.update(batchDocRef, {
                    currentCount: newCurrentCount,
                    totalMortality: newTotalMortality,
                    currentMortalityRate: parseFloat(newMortalityRate.toFixed(2)),
                    estimatedSalesRevenue: parseFloat(newEstimatedSalesRevenue.toFixed(2)), // ADDED THIS LINE
                    estimatedProfitLoss: parseFloat(newEstimatedProfitLoss.toFixed(2)),   // ADDED THIS LINE
                    updatedAt: serverTimestamp() // Always good to timestamp updates
                });

                // 7. Add the new mortality record (also part of the transaction)
                // Using transaction.set with doc() creates a new document with an auto-ID.
                transaction.set(doc(mortalityRecordsCollectionRef), {
                    batchId: selectedBatchId,
                    date: mortalityDate,
                    count: parsedMortalityCount,
                    reason: reason,
                    notes: notes,
                    createdAt: serverTimestamp()
                });

            }); // --- END OF runTransaction ---

            // --- END OF MODIFICATIONS ---

            // If the transaction completes successfully, then clear form fields and show success notification
            setSelectedBatchId('');
            setMortalityDate('');
            setMortalityCount('');
            setReason('');
            setNotes('');
            setNotificationMessage("Mortality recorded and batch updated successfully!");
            setNotificationType('success');

        } catch (addError) {
            console.error("Error adding mortality record or updating batch:", addError);
            let errorMessage = "Failed to record mortality.";
            // Custom error messages thrown within the transaction can be caught here
            if (addError.message) { // Use .message for Error objects
                errorMessage = addError.message;
            }
            setNotificationMessage(errorMessage);
            setNotificationType('error');
        }
    };

    const openEditMortalityModal = (record) => {
        setMortalityRecordToEdit(record);
        setIsEditMortalityModalOpen(true);
    };

    const handleSaveEditedMortality = async (updatedRecordData) => {
        if (!db || !userId || !mortalityRecordToEdit?.id) {
            setNotificationMessage("Firebase not initialized or mortality record ID missing for update.");
            setNotificationType('error');
            return;
        }

        const originalRecord = mortalityRecordToEdit;
        const oldBatchId = originalRecord.batchId;
        const oldMortalityCount = originalRecord.count;

        const newMortalityCount = parseInt(updatedRecordData.count, 10);
        const newBatchId = updatedRecordData.batchId;

        if (isNaN(newMortalityCount) || newMortalityCount <= 0) {
            setNotificationMessage("Please enter a valid positive number for mortality count.");
            setNotificationType('error');
            return;
        }

        try {
            // Use a transaction to ensure atomicity for complex updates across potentially multiple documents
            await runTransaction(db, async (transaction) => {
                // Fetch the current state of batches within the transaction for up-to-date data
                const oldBatchDocRef = doc(db, `artifacts/${appId}/users/${userId}/broilerBatches`, oldBatchId);
                const oldBatchSnap = await transaction.get(oldBatchDocRef);
                const oldBatchData = oldBatchSnap.exists() ? oldBatchSnap.data() : null;

                const newBatchDocRef = doc(db, `artifacts/${appId}/users/${userId}/broilerBatches`, newBatchId);
                const newBatchSnap = await transaction.get(newBatchDocRef);
                const newBatchData = newBatchSnap.exists() ? newBatchSnap.data() : null;

                if (!oldBatchData) {
                    console.warn("Original batch not found for mortality edit reversion:", oldBatchId);
                    // Deciding how to handle this: If the old batch is gone, we might still proceed with new batch update.
                    // For now, we'll log a warning and let the transaction potentially continue if newBatchData exists.
                }

                if (!newBatchData) {
                    setNotificationMessage("Target batch for update not found. Update failed.");
                    setNotificationType('error');
                    throw new Error("Target batch not found for update."); // This will roll back the transaction
                }

                // Calculate reverted state for the original batch
                let revertedCurrentCountOldBatch = oldBatchData ? oldBatchData.currentCount + oldMortalityCount : 0;
                let revertedTotalMortalityOldBatch = oldBatchData ? Math.max(0, (oldBatchData.totalMortality || 0) - oldMortalityCount) : 0;
                let revertedMortalityRateOldBatch = 0;
                if (oldBatchData?.initialTotal && oldBatchData.initialTotal > 0) {
                    revertedMortalityRateOldBatch = (revertedTotalMortalityOldBatch / oldBatchData.initialTotal) * 100;
                }

                // Calculate updated state for the new target batch
                let updatedCurrentCountNewBatch = newBatchData.currentCount - newMortalityCount;
                let updatedTotalMortalityNewBatch = (newBatchData.totalMortality || 0) + newMortalityCount;
                let updatedMortalityRateNewBatch = 0;
                if (newBatchData.initialTotal && newBatchData.initialTotal > 0) {
                    updatedMortalityRateNewBatch = (updatedTotalMortalityNewBatch / newBatchData.initialTotal) * 100;
                }

                // Safety check: ensure new mortality count doesn't exceed available birds in the new batch
                // This accounts for if the batch is the same (old mortality is added back virtually before subtracting new)
                if (newMortalityCount > (newBatchData.currentCount + (oldBatchId === newBatchId ? oldMortalityCount : 0))) {
                     setNotificationMessage("New mortality count exceeds available birds in the selected batch. Update cancelled.");
                     setNotificationType('error');
                     throw new Error("Mortality count exceeds available birds."); // Rollback transaction
                }

                // Apply updates based on whether the batch changed or not
                if (oldBatchId === newBatchId) {
                    // If the batch ID is the same, just one update is needed for the combined effect
                    transaction.update(oldBatchDocRef, { // oldBatchDocRef is the same as newBatchDocRef here
                        currentCount: updatedCurrentCountNewBatch,
                        totalMortality: updatedTotalMortalityNewBatch,
                        currentMortalityRate: updatedMortalityRateNewBatch
                    });
                } else {
                    // If batch ID changed, update both original and new batches
                    if (oldBatchData) { // Only update if old batch data was successfully retrieved
                        transaction.update(oldBatchDocRef, {
                            currentCount: revertedCurrentCountOldBatch,
                            totalMortality: revertedTotalMortalityOldBatch,
                            currentMortalityRate: revertedMortalityRateOldBatch
                        });
                    }
                    transaction.update(newBatchDocRef, {
                        currentCount: updatedCurrentCountNewBatch,
                        totalMortality: updatedTotalMortalityNewBatch,
                        currentMortalityRate: updatedMortalityRateNewBatch
                    });
                }

                // Finally, update the mortality record itself
                const mortalityDocRef = doc(db, `artifacts/${appId}/users/${userId}/mortalityRecords`, mortalityRecordToEdit.id);
                transaction.update(mortalityDocRef, {
                    batchId: newBatchId, // Update batchId if it changed
                    date: updatedRecordData.date,
                    count: newMortalityCount,
                    reason: updatedRecordData.reason,
                    notes: updatedRecordData.notes,
                    updatedAt: serverTimestamp()
                });
            }); // End of transaction

            setIsEditMortalityModalOpen(false);
            setMortalityRecordToEdit(null);
            setNotificationMessage("Mortality record updated successfully!");
            setNotificationType('success');

        } catch (updateError) {
            console.error("Error updating mortality record or batch during transaction:", updateError);
            // Check if it's our custom error for exceeding birds
            if (updateError.message.includes("exceeds available birds")) {
                // Notification message already set inside the transaction block
            } else {
                setNotificationMessage(`Failed to update mortality record: ${updateError.message}`);
            }
            setNotificationType('error');
        }
    };

    const openDeleteMortalityConfirm = (record) => {
        setMortalityRecordToDelete(record);
        setIsDeleteMortalityConfirmOpen(true);
    };

    const handleDeleteMortality = async () => {
        if (!db || !userId || !mortalityRecordToDelete?.id || !mortalityRecordToDelete?.batchId || typeof mortalityRecordToDelete?.count !== 'number') {
            setNotificationMessage("Firebase not initialized or mortality record data is incomplete for deletion.");
            setNotificationType('error');
            return;
        }

        const deletedCount = mortalityRecordToDelete.count;
        const batchId = mortalityRecordToDelete.batchId;

        try {
            await runTransaction(db, async (transaction) => {
                const batchDocRef = doc(db, `artifacts/${appId}/users/${userId}/broilerBatches`, batchId);
                const batchSnap = await transaction.get(batchDocRef); // Get batch data within the transaction

                if (batchSnap.exists()) {
                    const batchData = batchSnap.data();

                    const revertedCurrentCount = batchData.currentCount + deletedCount;
                    const revertedTotalMortality = Math.max(0, (batchData.totalMortality || 0) - deletedCount); // Use Math.max for safety

                    // Calculate the new mortality rate for the batch after deletion
                    let newMortalityRate = 0;
                    if (batchData.initialTotal && batchData.initialTotal > 0) {
                        newMortalityRate = (revertedTotalMortality / batchData.initialTotal) * 100;
                    }

                    // --- START NEW LINES FOR FINANCIAL RECALCULATION ---
                    // Retrieve financial inputs from the batch data
                    const proposedSellingPricePerBird = batchData.proposedSellingPricePerBird || 0;
                    const chickPrice = batchData.chickPrice || 0;
                    const purchasedChickCount = batchData.purchasedChickCount || 0;
                    const estimatedFeedCost = batchData.estimatedFeedCost || 0;

                    // Recalculate estimated sales revenue based on the REVERTED (increased) currentCount
                    // (Assuming 0.95 factor for revenue)
                    const newEstimatedSalesRevenue = (revertedCurrentCount * proposedSellingPricePerBird) * 0.95;

                    // Calculate initial chick purchase cost
                    const initialChickPurchaseCost = chickPrice * purchasedChickCount;

                    // Recalculate estimated profit/loss
                    const newEstimatedProfitLoss = newEstimatedSalesRevenue - initialChickPurchaseCost - estimatedFeedCost;
                    // --- END NEW LINES FOR FINANCIAL RECALCULATION ---


                    // Update the batch document
                    transaction.update(batchDocRef, {
                        currentCount: revertedCurrentCount,
                        totalMortality: revertedTotalMortality,
                        currentMortalityRate: parseFloat(newMortalityRate.toFixed(2)), // Ensure 2 decimal places
                        estimatedSalesRevenue: parseFloat(newEstimatedSalesRevenue.toFixed(2)), // ADDED THIS LINE
                        estimatedProfitLoss: parseFloat(newEstimatedProfitLoss.toFixed(2)),   // ADDED THIS LINE
                        updatedAt: serverTimestamp() // Always good practice to update timestamp
                    });
                } else {
                    // If the batch doesn't exist, we can still delete the mortality record
                    // but we should log a warning as batch stats won't be reverted.
                    console.warn("Batch not found for mortality deletion reversion. Deleting mortality record only.", batchId);
                    // Optionally, you could throw an error here if you consider a missing batch
                    // a critical failure for the entire operation.
                }

                // Delete the mortality record
                const mortalityDocRef = doc(db, `artifacts/${appId}/users/${userId}/mortalityRecords`, mortalityRecordToDelete.id);
                transaction.delete(mortalityDocRef);
            }); // End of transaction

            setIsDeleteMortalityConfirmOpen(false);
            setMortalityRecordToDelete(null);
            setNotificationMessage("Mortality record deleted successfully and batch metrics updated!"); // Updated message
            setNotificationType('success');
        } catch (deleteError) {
            console.error("Error deleting mortality record or updating batch during transaction:", deleteError);
            let errorMessage = `Failed to delete mortality record: ${deleteError.message}`;
            // If an error object was thrown (like from "new Error(...)")
            if (deleteError instanceof Error && deleteError.message) {
                errorMessage = deleteError.message;
            } else if (typeof deleteError === 'string') { // If a string was thrown
                errorMessage = deleteError;
            }
            setNotificationMessage(errorMessage);
            setNotificationType('error');
        }
    };

    const groupedMortalityRecords = mortalityRecords.reduce((acc, record) => {
        const batchName = batches.find(b => b.id === record.batchId)?.name || `Unknown Batch (${record.batchId})`;
        if (!acc[batchName]) {
            acc[batchName] = [];
        }
        acc[batchName].push(record);
        return acc;
    }, {});

    return (
        <div className="p-6 bg-gray-50 rounded-lg shadow-inner">
            <div className="mb-8 p-6 bg-gray-50 rounded-lg shadow-inner">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-semibold text-gray-700">Record Mortality</h2>
                    <button
                        onClick={() => setIsRecordMortalityFormExpanded(!isRecordMortalityFormExpanded)}
                        className="p-2 rounded-full bg-gray-200 hover:bg-gray-300 transition duration-150"
                        aria-expanded={isRecordMortalityFormExpanded}
                        aria-controls="record-mortality-form"
                    >
                        {isRecordMortalityFormExpanded ? (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                            </svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                            </svg>
                        )}
                    </button>
                </div>

                {isRecordMortalityFormExpanded && (
                    <form onSubmit={handleAddMortality} className="grid grid-cols-1 md:grid-cols-2 gap-4" id="record-mortality-form">
                        <div>
                            <label htmlFor="selectBatchMortality" className="block text-sm font-medium text-gray-700 mb-1">Select Batch</label>
                            <select
                                id="selectBatchMortality"
                                value={selectedBatchId}
                                onChange={(e) => setSelectedBatchId(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            >
                                <option value="">-- Select a Batch --</option>
                                {batches.map(batch => (
                                    <option key={batch.id} value={batch.id}>{batch.name} (Current: {batch.currentCount} birds)</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="mortalityDate" className="block text-sm font-medium text-gray-700 mb-1">Date of Mortality</label>
                            <input
                                type="date"
                                id="mortalityDate"
                                value={mortalityDate}
                                onChange={(e) => setMortalityDate(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="mortalityCount" className="block text-sm font-medium text-gray-700 mb-1">Number of Birds</label>
                            <input
                                type="number"
                                id="mortalityCount"
                                value={mortalityCount}
                                onChange={(e) => setMortalityCount(e.target.value)}
                                placeholder="e.g., 5"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                min="1"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="reason" className="block text-sm font-medium text-gray-700 mb-1">Reason (Optional)</label>
                            <input
                                type="text"
                                id="reason"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="e.g., Disease, Injury"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
                            <textarea
                                id="notes"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="e.g., Observed symptoms before death"
                                rows="2"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                            ></textarea>
                        </div>
                        <div className="md:col-span-2">
                            <button
                                type="submit"
                                className="w-full bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition duration-200 ease-in-out shadow-md"
                            >
                                Record Mortality
                            </button>
                        </div>
                    </form>
                )}
            </div>

            <h2 className="text-2xl font-semibold text-gray-700 mb-4">Mortality History</h2>
            {mortalityError && <p className="text-red-600 mb-4">{mortalityError}</p>}
            {loadingMortality ? (
                <p className="text-gray-500 text-center py-8">Loading mortality records...</p>
            ) : Object.keys(groupedMortalityRecords).length === 0 ? (
                <p className="text-gray-500 text-center py-8">No mortality records yet.</p>
            ) : (
                <div className="space-y-6">
                    {Object.entries(groupedMortalityRecords).map(([batchName, records]) => (
                        <div key={batchName} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                            <h3 className="text-lg font-bold text-gray-800 mb-3">{batchName}</h3>
                            <ul className="divide-y divide-gray-200">
                                {records.map(record => (
                                    <li key={record.id} className="py-3 flex justify-between items-center flex-wrap gap-2">
                                        <div>
                                            <p className="text-sm text-gray-800">
                                                <span className="font-semibold">Date:</span> {record.date}
                                            </p>
                                            <p className="text-sm text-gray-800">
                                                <span className="font-semibold">Count:</span> {record.count} birds
                                            </p>
                                            {record.reason && (
                                                <p className="text-sm text-gray-800">
                                                    <span className="font-semibold">Reason:</span> {record.reason}
                                                </p>
                                            )}
                                            {record.notes && (
                                                <p className="text-xs text-gray-600">
                                                    <span className="font-semibold">Notes:</span> {record.notes}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex space-x-2 mt-2 sm:mt-0">
                                            <button
                                                onClick={() => openEditMortalityModal(record)}
                                                className="text-blue-600 hover:text-blue-800 text-sm px-3 py-1 rounded-md border border-blue-600 hover:border-blue-800 transition duration-150"
                                            >
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => openDeleteMortalityConfirm(record)}
                                                className="text-red-600 hover:text-red-800 text-sm px-3 py-1 rounded-md border border-red-600 hover:border-red-800 transition duration-150"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            )}

            {isEditMortalityModalOpen && (
                <EditMortalityModal
                    record={mortalityRecordToEdit}
                    onClose={() => setIsEditMortalityModalOpen(false)}
                    onSave={handleSaveEditedMortality}
                    batches={batches}
                />
            )}

            {isDeleteMortalityConfirmOpen && (
                <DeleteMortalityConfirmModal
                    record={mortalityRecordToDelete}
                    onClose={() => setIsDeleteMortalityConfirmOpen(false)}
                    onConfirm={handleDeleteMortality}
                    batches={batches}
                />
            )}
        </div>
    );
};

// --- EditMortalityModal Component ---
const EditMortalityModal = ({ record, onClose, onSave, batches }) => {
    const [editedBatchId, setEditedBatchId] = useState(record.batchId);
    const [editedDate, setEditedDate] = useState(record.date);
    const [editedCount, setEditedCount] = useState(record.count);
    const [editedReason, setEditedReason] = useState(record.reason || '');
    const [editedNotes, setEditedNotes] = useState(record.notes || '');
    const [errorMessage, setErrorMessage] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        setErrorMessage('');

        const parsedCount = parseInt(editedCount, 10);

        if (!editedBatchId || !editedDate || isNaN(parsedCount) || parsedCount <= 0) {
            setErrorMessage("Please fill all required fields correctly (Batch, Date, Count).");
            return;
        }

        const updatedData = {
            batchId: editedBatchId,
            date: editedDate,
            count: parsedCount,
            reason: editedReason,
            notes: editedNotes
        };
        onSave(updatedData);
    };

    const batchName = batches.find(b => b.id === record.batchId)?.name || 'Unknown Batch';

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md flex flex-col max-h-[90vh]"> {/* Added flex-col and max-h-[90vh] */}
                <h2 className="text-2xl font-bold text-gray-800 mb-4 flex-shrink-0">Edit Mortality for {batchName}</h2>
                {errorMessage && <p className="text-red-600 mb-4 flex-shrink-0">{errorMessage}</p>}
                <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto pr-2 flex-grow"> {/* Added overflow-y-auto and flex-grow */}
                    <div>
                        <label htmlFor="editMortalityBatch" className="block text-sm font-medium text-gray-700 mb-1">Batch</label>
                        <select
                            id="editMortalityBatch"
                            value={editedBatchId}
                            onChange={(e) => setEditedBatchId(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                        >
                            {batches.map(batch => (
                                <option key={batch.id} value={batch.id}>{batch.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="editMortalityDate" className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                        <input
                            type="date"
                            id="editMortalityDate"
                            value={editedDate}
                            onChange={(e) => setEditedDate(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editMortalityCount" className="block text-sm font-medium text-gray-700 mb-1">Number of Birds</label>
                        <input
                            type="number"
                            id="editMortalityCount"
                            value={editedCount}
                            onChange={(e) => setEditedCount(e.target.value)}
                            step="1"
                            className="w-full p-2 border border-gray-300 rounded-md"
                            min="1"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editReason" className="block text-sm font-medium text-gray-700 mb-1">Reason (Optional)</label>
                        <input
                            type="text"
                            id="editReason"
                            value={editedReason}
                            onChange={(e) => setEditedReason(e.target.value)}
                            placeholder="e.g., Disease, Injury"
                            className="w-full p-2 border border-gray-300 rounded-md"
                        />
                    </div>
                    <div>
                        <label htmlFor="editNotes" className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
                        <textarea
                            id="editNotes"
                            value={editedNotes}
                            onChange={(e) => setEditedNotes(e.target.value)}
                            rows="2"
                            className="w-full p-2 border border-gray-300 rounded-md"
                        ></textarea>
                    </div>
                </form>
                <div className="flex justify-end space-x-3 mt-6 flex-shrink-0"> {/* Added flex-shrink-0 */}
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-150"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        onClick={handleSubmit} // Call handleSubmit here for form submission
                        className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition duration-150"
                    >
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- DeleteMortalityConfirmModal Component ---
const DeleteMortalityConfirmModal = ({ record, onClose, onConfirm, batches }) => {
    const batchName = batches.find(b => b.id === record.batchId)?.name || record.batchId;

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm text-center">
                <h2 className="text-xl font-bold text-gray-800 mb-4">Confirm Deletion</h2>
                <p className="text-gray-700 mb-6">
                    Are you sure you want to delete the mortality record of <span className="font-semibold">{record?.count}</span> birds from batch "<span className="font-semibold">{batchName}</span>" on {record?.date}?
                    This action cannot be undone.
                </p>
                <div className="flex justify-center space-x-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-150"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition duration-150"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
};


// --- FeedManagementTab Component ---
const FeedManagementTab = ({ batches, setNotificationMessage, setNotificationType }) => {
    const { db, userId, appId } = useContext(AppContext);

    const [selectedBatchId, setSelectedBatchId] = useState(''); // For the "Record Feed Consumption" form
    const [feedDate, setFeedDate] = useState('');
    const [quantityKg, setQuantityKg] = useState('');
    const [feedNotes, setFeedNotes] = useState('');
    const [feedRecords, setFeedRecords] = useState([]);
    const [loadingFeed, setLoadingFeed] = useState(true);
    const [feedError, setFeedError] = useState(null);

    const [supplyInventory, setSupplyInventory] = useState([]);
    const [loadingInventory, setLoadingInventory] = useState(true);
    const [inventoryError, setInventoryError] = useState(null);
    const [selectedSupplyItemId, setSelectedSupplyItemId] = useState('');

    const [isRecordFeedFormExpanded, setIsRecordFeedFormExpanded] = useState(false);
    const [isEditFeedModalOpen, setIsEditFeedModalOpen] = useState(false);
    const [feedRecordToEdit, setFeedRecordToEdit] = useState(null);
    const [isDeleteFeedConfirmOpen, setIsDeleteFeedConfirmOpen] = useState(false);
    const [feedRecordToDelete, setFeedRecordToDelete] = useState(null);

    // New state for selecting an active batch to display
    const [activeBatchId, setActiveBatchId] = useState('');

    // Effect to fetch feed records
    useEffect(() => {
        if (!db || !userId) return;
        setLoadingFeed(true);
        setFeedError(null);
        try {
            const feedCollectionPath = `artifacts/${appId}/users/${userId}/feedRecords`;
            const feedCollectionRef = collection(db, feedCollectionPath);
            const unsubscribe = onSnapshot(feedCollectionRef, (snapshot) => {
                const fetchedRecords = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                const sortedRecords = [...fetchedRecords].sort((a, b) => {
                    const dateA = a.date ? new Date(a.date) : new Date(0);
                    const dateB = b.date ? new Date(b.date) : new Date(0);
                    return dateB.getTime() - dateA.getTime();
                });
                setFeedRecords(sortedRecords);
                setLoadingFeed(false);
            }, (snapshotError) => {
                console.error("Error fetching feed records:", snapshotError);
                setFeedError(`Failed to load feed records: ${snapshotError.message}`);
                setLoadingFeed(false);
            });
            return () => unsubscribe();
        } catch (fetchError) {
            console.error("Error setting up feed listener:", fetchError);
            setFeedError(`Error setting up feed listener: ${fetchError.message}`);
            setLoadingFeed(false);
        }
    }, [db, userId, appId]);

    // Effect to fetch supply inventory (feed items only)
    useEffect(() => {
        if (!db || !userId) return;
        setLoadingInventory(true);
        setInventoryError(null);
        try {
            const inventoryCollectionPath = `artifacts/${appId}/users/${userId}/supplyInventory`;
            const inventoryCollectionRef = collection(db, inventoryCollectionPath);
            const unsubscribe = onSnapshot(inventoryCollectionRef, (snapshot) => {
                const fetchedInventory = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                const feedItems = fetchedInventory.filter(item => item.category === 'Feed');
                setSupplyInventory(feedItems);
                setLoadingInventory(false);
            }, (snapshotError) => {
                console.error("Error fetching supply inventory:", snapshotError);
                setInventoryError(`Failed to load supply inventory: ${snapshotError.message}`);
                setLoadingInventory(false);
            });
            return () => unsubscribe();
        } catch (fetchError) {
            console.error("Error setting up inventory listener:", fetchError);
            setInventoryError(`Error setting up inventory listener: ${fetchError.message}`);
            setLoadingInventory(false);
        }
    }, [db, userId, appId]);

            // Memoized computation for grouped feed records and totals based on activeBatchId
        const groupedFeedRecordsWithTotals = useMemo(() => {
            const filteredRecords = activeBatchId
                ? feedRecords.filter(record => record.batchId === activeBatchId)
                : feedRecords; // If no activeBatchId, show all

            return filteredRecords.reduce((acc, record) => {
                const batchId = record.batchId;
                const batchName = batches.find(b => b.id === batchId)?.name || `Unknown Batch (${batchId})`;
                const feedTypeName = supplyInventory.find(item => item.id === record.supplyItemId)?.name || record.feedTypeName || 'N/A';

                if (!acc[batchId]) {
                    acc[batchId] = {
                        batchName: batchName,
                        totalFeedConsumedKg: 0, // Changed from totalFeedConsumed
                        totalFeedConsumedBags: 0, // NEW: Initialize bags
                        feedTypeBreakdown: {},
                        records: []
                    };
                }

                acc[batchId].totalFeedConsumedKg += record.quantityKg; // Updated property name
                acc[batchId].totalFeedConsumedBags += record.quantityKg / STANDARD_BAG_SIZE_KG; // NEW: Calculate bags for total

                // Modify this part to store an object { kg, bags }
                if (!acc[batchId].feedTypeBreakdown[feedTypeName]) {
                    acc[batchId].feedTypeBreakdown[feedTypeName] = { kg: 0, bags: 0 }; // NEW: Initialize with kg and bags
                }
                acc[batchId].feedTypeBreakdown[feedTypeName].kg += record.quantityKg; // Update kg
                acc[batchId].feedTypeBreakdown[feedTypeName].bags += record.quantityKg / STANDARD_BAG_SIZE_KG; // NEW: Calculate bags for breakdown

                acc[batchId].records.push(record);
                return acc;
            }, {});
        }, [feedRecords, batches, supplyInventory, activeBatchId]); // Ensure STANDARD_BAG_SIZE_KG is accessible (it should be if defined outside App function)


    const handleAddFeed = async (e) => {
        e.preventDefault();
        if (!db || !userId) {
            setNotificationMessage("Firebase not initialized or user not authenticated.");
            setNotificationType('error');
            return;
        }
        if (!selectedBatchId || !feedDate || !selectedSupplyItemId || !quantityKg) {
            setNotificationMessage("Please select a batch, date, feed type, and quantity.");
            setNotificationType('error');
            return;
        }

        const parsedQuantityKg = parseFloat(quantityKg);
        if (isNaN(parsedQuantityKg) || parsedQuantityKg <= 0) {
            setNotificationMessage("Please enter a valid positive number for quantity.");
            setNotificationType('error');
            return;
        }

        const selectedBatch = batches.find(b => b.id === selectedBatchId);
        if (!selectedBatch) {
            setNotificationMessage("Selected batch not found.");
            setNotificationType('error');
            return;
        }

        const inventoryItem = supplyInventory.find(item => item.id === selectedSupplyItemId);
        if (!inventoryItem) {
            setNotificationMessage("Selected feed type not found in inventory.");
            setNotificationType('error');
            return;
        }
        if (inventoryItem.currentStock < parsedQuantityKg) {
            setNotificationMessage(`Not enough "${inventoryItem.name}" in inventory. Current stock: ${inventoryItem.currentStock.toFixed(2)} ${inventoryItem.unit}. Please restock.`);
            setNotificationType('error');
            return;
        }

        try {
            // 1. Update inventory stock
            const inventoryDocRef = doc(db, `artifacts/${appId}/users/${userId}/supplyInventory`, inventoryItem.id);
            await updateDoc(inventoryDocRef, {
                currentStock: inventoryItem.currentStock - parsedQuantityKg,
                updatedAt: serverTimestamp()
            });

            // 2. Add feed record
            const feedCollectionPath = `artifacts/${appId}/users/${userId}/feedRecords`;
            await addDoc(collection(db, feedCollectionPath), {
                batchId: selectedBatchId,
                date: feedDate,
                supplyItemId: selectedSupplyItemId,
                feedTypeName: inventoryItem.name, // Store name for easier display
                quantityKg: parsedQuantityKg,
                notes: feedNotes,
                createdAt: serverTimestamp(),
            });

            // 3. Update total feed consumed on the batch record
            const batchDocRef = doc(db, `artifacts/${appId}/users/${userId}/broilerBatches`, selectedBatchId);
            // Fetch current batch data to ensure atomic update of feedConsumed
            const batchSnap = await getDoc(batchDocRef);
            if (batchSnap.exists()) {
                const currentBatchFeedConsumed = batchSnap.data().feedConsumed || 0;
                const newFeedConsumed = currentBatchFeedConsumed + parsedQuantityKg;
                await updateDoc(batchDocRef, { feedConsumed: newFeedConsumed });
            } else {
                console.warn(`Batch with ID ${selectedBatchId} not found when updating feedConsumed.`);
            }

            // Clear form fields
            setSelectedBatchId('');
            setFeedDate('');
            setSelectedSupplyItemId('');
            setQuantityKg('');
            setFeedNotes('');
            setNotificationMessage("Feed recorded and inventory updated successfully!");
            setNotificationType('success');
        } catch (addError) {
            console.error("Error adding feed record or updating batch/inventory:", addError);
            setNotificationMessage(`Failed to record feed: ${addError.message}`);
            setNotificationType('error');
        }
    };

    const openEditFeedModal = (record) => {
        setFeedRecordToEdit(record);
        setIsEditFeedModalOpen(true);
    };

    const handleSaveEditedFeed = async (updatedRecordData) => {
        if (!db || !userId || !feedRecordToEdit?.id) {
            setNotificationMessage("Firebase not initialized or feed record ID missing for update.");
            setNotificationType('error');
            return;
        }
        const originalRecord = feedRecordToEdit;
        const originalQuantity = originalRecord.quantityKg;
        const originalSupplyItemId = originalRecord.supplyItemId;
        const newQuantity = parseFloat(updatedRecordData.quantityKg);
        const newSupplyItemId = updatedRecordData.supplyItemId;
        const batchId = updatedRecordData.batchId;

        if (isNaN(newQuantity) || newQuantity <= 0) {
            setNotificationMessage("Please enter a valid positive quantity for feed.");
            setNotificationType('error');
            return;
        }

        try {
            // 1. Adjust original inventory item: return original quantity
            const originalInventoryDocRef = doc(db, `artifacts/${appId}/users/${userId}/supplyInventory`, originalSupplyItemId);
            const originalSnap = await getDoc(originalInventoryDocRef);
            let updatedOriginalStock = originalSnap.exists() ? originalSnap.data().currentStock + originalQuantity : originalQuantity;

            // 2. Adjust new/same inventory item: subtract new quantity
            const newInventoryDocRef = doc(db, `artifacts/${appId}/users/${userId}/supplyInventory`, newSupplyItemId);
            const newSnap = originalSupplyItemId === newSupplyItemId ? originalSnap : await getDoc(newInventoryDocRef);

            if (!newSnap.exists() && originalSupplyItemId !== newSupplyItemId) {
                setNotificationMessage("New feed type not found in inventory. Cannot update.");
                setNotificationType('error');
                return;
            }

            let finalNewStock = (newSnap.exists() ? newSnap.data().currentStock : 0);
            if (originalSupplyItemId === newSupplyItemId) {
                 finalNewStock = updatedOriginalStock - newQuantity;
            } else {
                finalNewStock = finalNewStock - newQuantity;
            }

            if (finalNewStock < 0) {
                setNotificationMessage(`Not enough "${supplyInventory.find(item => item.id === newSupplyItemId)?.name || 'selected feed'}" in inventory for this update. Available: ${((newSnap.exists() ? newSnap.data().currentStock : 0) + (originalSupplyItemId === newSupplyItemId ? originalQuantity : 0)).toFixed(2)} kg`);
                setNotificationType('error');
                return;
            }

            // Perform updates if checks pass
            if (originalSupplyItemId === newSupplyItemId) {
                await updateDoc(originalInventoryDocRef, { currentStock: finalNewStock, updatedAt: serverTimestamp() });
            } else {
                await updateDoc(originalInventoryDocRef, { currentStock: updatedOriginalStock, updatedAt: serverTimestamp() });
                await updateDoc(newInventoryDocRef, { currentStock: finalNewStock, updatedAt: serverTimestamp() });
            }

            // 3. Update total feed consumed on the batch record
            const batchDocRef = doc(db, `artifacts/${appId}/users/${userId}/broilerBatches`, batchId);
            const batchSnap = await getDoc(batchDocRef);
            if (batchSnap.exists()) {
                const currentBatchFeedConsumed = batchSnap.data().feedConsumed || 0;
                const updatedBatchFeedConsumed = currentBatchFeedConsumed - originalQuantity + newQuantity;
                await updateDoc(batchDocRef, { feedConsumed: updatedBatchFeedConsumed });
            } else {
                console.warn(`Batch with ID ${batchId} not found when updating feedConsumed.`);
            }

            // 4. Update the feed record itself
            const feedRecordDocRef = doc(db, `artifacts/${appId}/users/${userId}/feedRecords`, feedRecordToEdit.id);
            const newFeedTypeName = supplyInventory.find(item => item.id === newSupplyItemId)?.name || 'N/A';
            await updateDoc(feedRecordDocRef, {
                batchId: updatedRecordData.batchId,
                date: updatedRecordData.date,
                supplyItemId: newSupplyItemId,
                feedTypeName: newFeedTypeName,
                quantityKg: newQuantity,
                notes: updatedRecordData.notes,
                updatedAt: serverTimestamp()
            });

            setIsEditFeedModalOpen(false);
            setFeedRecordToEdit(null);
            setNotificationMessage("Feed record updated successfully!");
            setNotificationType('success');
        } catch (updateError) {
            console.error("Error updating feed record:", updateError);
            setNotificationMessage(`Failed to update feed record: ${updateError.message}`);
            setNotificationType('error');
        }
    };

    const openDeleteFeedConfirm = (record) => {
        setFeedRecordToDelete(record);
        setIsDeleteFeedConfirmOpen(true);
    };

    const handleDeleteFeed = async () => {
        if (!db || !userId || !feedRecordToDelete?.id) {
            setNotificationMessage("Firebase not initialized or feed record ID missing for deletion.");
            setNotificationType('error');
            return;
        }

        const deletedQuantity = feedRecordToDelete.quantityKg;
        const deletedSupplyItemId = feedRecordToDelete.supplyItemId;
        const batchId = feedRecordToDelete.batchId;

        try {
            // 1. Return quantity to inventory
            const inventoryDocRef = doc(db, `artifacts/${appId}/users/${userId}/supplyInventory`, deletedSupplyItemId);
            const inventorySnap = await getDoc(inventoryDocRef);
            if (inventorySnap.exists()) {
                await updateDoc(inventoryDocRef, { currentStock: inventorySnap.data().currentStock + deletedQuantity, updatedAt: serverTimestamp() });
            }

            // 2. Subtract quantity from batch's total feed consumed
            const batchDocRef = doc(db, `artifacts/${appId}/users/${userId}/broilerBatches`, batchId);
            const batchSnap = await getDoc(batchDocRef);
            if (batchSnap.exists()) {
                const currentBatchFeedConsumed = batchSnap.data().feedConsumed || 0;
                await updateDoc(batchDocRef, { feedConsumed: Math.max(0, currentBatchFeedConsumed - deletedQuantity) });
            }

            // 3. Delete the feed record
            const feedRecordDocRef = doc(db, `artifacts/${appId}/users/${userId}/feedRecords`, feedRecordToDelete.id);
            await deleteDoc(feedRecordDocRef);

            setIsDeleteFeedConfirmOpen(false);
            setFeedRecordToDelete(null);
            setNotificationMessage("Feed record deleted successfully!");
            setNotificationType('success');
        } catch (deleteError) {
            console.error("Error deleting feed record:", deleteError);
            setNotificationMessage(`Failed to delete feed record: ${deleteError.message}`);
            setNotificationType('error');
        }
    };

    // Helper to get feed name (used in rendering history)
    const getFeedName = (supplyItemId) => {
        return supplyInventory.find(item => item.id === supplyItemId)?.name || 'N/A';
    };

    const activeBatchData = activeBatchId ? groupedFeedRecordsWithTotals[activeBatchId] : null;

    return (
        <div className="p-6 bg-gray-50 rounded-lg shadow-inner">
            <div className="mb-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
                <h3 className="text-xl font-semibold text-gray-700 mb-2">Current Feed Inventory</h3>
                {inventoryError && <p className="text-red-600 mb-4">{inventoryError}</p>}
                {loadingInventory ? (
                    <p className="text-gray-500">Loading inventory...</p>
                ) : supplyInventory.length === 0 ? (
                    <p className="text-gray-500">No feed types in inventory. Please add them via the Supply Inventory tab.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full bg-white">
                            <thead>
                                <tr className="bg-gray-100 text-left text-sm font-medium text-gray-600 uppercase tracking-wider">
                                    <th className="py-2 px-3">Feed Type</th>
                                    <th className="py-2 px-3 text-right">Current Stock ({supplyInventory[0]?.unit || 'kg'})</th>
                                </tr>
                            </thead>
                            <tbody>
                                {supplyInventory
                                // ADD THIS .sort() METHOD HERE:
                                .sort((itemA, itemB) => {
                                    const order = [
                                        'Starter Crumbs Feed',
                                        'Grower Crumbs Feed',
                                        'Grower Pallets Feed',
                                        'Finisher Pallets Feed'
                                    ];
                                    const indexA = order.indexOf(itemA.name); // Sort by item.name
                                    const indexB = order.indexOf(itemB.name); // Sort by item.name

                                    // Handle cases where a feed type might not be in the predefined order
                                    if (indexA === -1 && indexB === -1) return 0;
                                    if (indexA === -1) return 1;
                                    if (indexB === -1) return -1;

                                    return indexA - indexB;
                                })
                                .map(item => (
                                    <tr key={item.id} className="border-b border-gray-200 last:border-b-0 hover:bg-gray-50">
                                        <td className="py-2 px-3 text-sm text-gray-800 capitalize">{item.name}</td>
                                        <td className="py-2 px-3 text-sm text-gray-800 text-right">{item.currentStock.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div className="mb-8 p-6 bg-gray-50 rounded-lg shadow-inner">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-semibold text-gray-700">Record Feed Consumption</h2>
                    <button
                        onClick={() => setIsRecordFeedFormExpanded(!isRecordFeedFormExpanded)}
                        className="p-2 rounded-full bg-gray-200 hover:bg-gray-300 transition duration-150"
                        aria-expanded={isRecordFeedFormExpanded}
                        aria-controls="record-feed-form"
                    >
                        {isRecordFeedFormExpanded ? (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                        )}
                    </button>
                </div>

                {isRecordFeedFormExpanded && (
                    <form onSubmit={handleAddFeed} className="grid grid-cols-1 md:grid-cols-2 gap-4" id="record-feed-form">
                        <div>
                            <label htmlFor="selectBatchFeed" className="block text-sm font-medium text-gray-700 mb-1">Select Batch</label>
                            <select
                                id="selectBatchFeed"
                                value={selectedBatchId}
                                onChange={(e) => setSelectedBatchId(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            >
                                <option value="">-- Select a Batch --</option>
                                {batches.map(batch => (
                                    <option key={batch.id} value={batch.id}>{batch.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="feedDate" className="block text-sm font-medium text-gray-700 mb-1">Date of Feed</label>
                            <input
                                type="date"
                                id="feedDate"
                                value={feedDate}
                                onChange={(e) => setFeedDate(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="feedType" className="block text-sm font-medium text-gray-700 mb-1">Feed Type</label>
                            <select
                                id="feedType"
                                value={selectedSupplyItemId}
                                onChange={(e) => setSelectedSupplyItemId(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            >
                                <option value="">-- Select Feed Type --</option>
                                {supplyInventory.map(item => (
                                    <option key={item.id} value={item.id}>{item.name} ({item.currentStock.toFixed(2)} {item.unit} available)</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="quantityKg" className="block text-sm font-medium text-gray-700 mb-1">Quantity (kg)</label>
                            <input
                                type="number"
                                id="quantityKg"
                                value={quantityKg}
                                onChange={(e) => setQuantityKg(e.target.value)}
                                placeholder="e.g., 25"
                                step="0.01"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                min="0.01"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="feedNotes" className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
                            <textarea
                                id="feedNotes"
                                value={feedNotes}
                                onChange={(e) => setFeedNotes(e.target.value)}
                                placeholder="e.g., First bag of starter feed"
                                rows="2"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                            ></textarea>
                        </div>
                        <div className="md:col-span-2">
                            <button
                                type="submit"
                                className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition duration-200 ease-in-out shadow-md"
                            >
                                Record Feed
                            </button>
                        </div>
                    </form>
                )}
            </div>

            {/* Batch Selection Dropdown */}
            <div className="mb-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
                <label htmlFor="activeBatchSelect" className="block text-lg font-medium text-gray-700 mb-2">View Feed Records For:</label>
                <select
                    id="activeBatchSelect"
                    value={activeBatchId}
                    onChange={(e) => setActiveBatchId(e.target.value)}
                    className="w-full md:w-1/2 p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                >
                    <option value="">-- All Batches --</option>
                    {batches.map(batch => (
                        <option key={batch.id} value={batch.id}>{batch.name}</option>
                    ))}
                </select>
            </div>

            {/* Batch Feed Consumption Summary Section */}
            <div className="mb-8 p-6 bg-white rounded-lg shadow-sm border border-gray-200">
                <h2 className="text-2xl font-semibold text-gray-700 mb-4">Batch Feed Consumption Summary</h2>
                {feedError && <p className="text-red-600 mb-4">{feedError}</p>}
                {loadingFeed ? (
                    <p className="text-gray-500 text-center py-4">Calculating summaries...</p>
                ) : Object.keys(groupedFeedRecordsWithTotals).length === 0 ? (
                    <p className="text-gray-500 text-center py-4">
                        {activeBatchId ? `No feed consumption recorded for ${batches.find(b => b.id === activeBatchId)?.name || 'this batch'}.` : "No feed consumption recorded for any batches yet."}
                    </p>
                ) : (
                    <div className="space-y-6">
                        {Object.entries(groupedFeedRecordsWithTotals).map(([batchId, data]) => (
                            <div key={batchId} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                                <h3 className="text-lg font-bold text-gray-800 mb-2">{data.batchName}</h3>
                                <p className="text-md text-gray-700 font-semibold mb-2">
                                    Total Feed Consumed: <span className="text-green-700">{data.totalFeedConsumedKg.toFixed(2)} kg</span>
                                    {data.totalFeedConsumedBags > 0 && ` (${data.totalFeedConsumedBags.toFixed(2)} bags)`}
                                </p>
                                {Object.keys(data.feedTypeBreakdown).length > 0 && (
                                    <div className="ml-2 mt-2">
                                        <p className="text-sm font-medium text-gray-600 mb-1">Feed Breakdown:</p>
                                        <ul className="list-disc list-inside text-sm text-gray-600">
                                            {Object.entries(data.feedTypeBreakdown)
                                             // Add this .sort() method:
                                            .sort(([feedTypeA], [feedTypeB]) => {
                                                const order = [
                                                    'Starter Crumbs Feed',
                                                    'Grower Crumbs Feed',
                                                    'Grower Pallets Feed',
                                                    'Finisher Pallets Feed'
                                                ];
                                                const indexA = order.indexOf(feedTypeA);
                                                const indexB = order.indexOf(feedTypeB);

                                                // Handle cases where a feed type might not be in the predefined order
                                                // (e.g., new feed types, or typos). Push them to the end.
                                                if (indexA === -1 && indexB === -1) return 0; // Both not in order, keep original relative order
                                                if (indexA === -1) return 1; // A not in order, push A to end
                                                if (indexB === -1) return -1; // B not in order, push B to end

                                                return indexA - indexB; // Sort by their index in the 'order' array
                                            })
                                            .map(([feedType, quantities]) => (
                                                <li key={feedType}>
                                                    {quantities.kg.toFixed(2)} kg
                                                    {quantities.bags > 0 && ` (${quantities.bags.toFixed(2)} bags)`} of {feedType}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Existing Feed History Section */}
            <h2 className="text-2xl font-semibold text-gray-700 mb-4">Feed History</h2>
            {feedError && <p className="text-red-600 mb-4">{feedError}</p>}
            {loadingFeed ? (
                <p className="text-gray-500 text-center py-8">Loading feed records...</p>
            ) : Object.keys(groupedFeedRecordsWithTotals).length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                    {activeBatchId ? `No feed records for ${batches.find(b => b.id === activeBatchId)?.name || 'this batch'}.` : "No feed records yet."}
                </p>
            ) : (
                <div className="space-y-6">
                    {Object.entries(groupedFeedRecordsWithTotals).map(([batchId, data]) => (
                        <div key={batchId} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                            <h3 className="text-lg font-bold text-gray-800 mb-3">{data.batchName}</h3>
                            <ul className="divide-y divide-gray-200">
                                {data.records.sort((a, b) => new Date(b.date) - new Date(a.date)).map(record => (
                                    <li key={record.id} className="py-3 flex justify-between items-center">
                                        <div>
                                            <p className="text-sm text-gray-800">
                                                <span className="font-semibold">Date:</span> {record.date}
                                            </p>
                                            <p className="text-sm text-gray-800">
                                                <span className="font-semibold">Type:</span> {record.feedTypeName || getFeedName(record.supplyItemId)}
                                            </p>
                                            <p className="text-sm text-gray-800">
                                                <span className="font-semibold">Quantity:</span> {record.quantityKg.toFixed(2)} kg
                                            </p>
                                            {record.notes && (
                                                <p className="text-xs text-gray-600">
                                                    <span className="font-semibold">Notes:</span> {record.notes}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex space-x-2">
                                            <button
                                                onClick={() => openEditFeedModal(record)}
                                                className="text-blue-600 hover:text-blue-800 text-sm px-3 py-1 rounded-md border border-blue-600 hover:border-blue-800 transition duration-150"
                                            >
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => openDeleteFeedConfirm(record)}
                                                className="text-red-600 hover:text-red-800 text-sm px-3 py-1 rounded-md border border-red-600 hover:border-red-800 transition duration-150"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            )}

            {isEditFeedModalOpen && (
                <EditFeedModal
                    record={feedRecordToEdit}
                    onClose={() => setIsEditFeedModalOpen(false)}
                    onSave={handleSaveEditedFeed}
                    supplyInventory={supplyInventory}
                />
            )}

            {isDeleteFeedConfirmOpen && (
                <DeleteFeedConfirmModal
                    record={feedRecordToDelete}
                    onClose={() => setIsDeleteFeedConfirmOpen(false)}
                    onConfirm={handleDeleteFeed}
                    batches={batches}
                    supplyInventory={supplyInventory}
                />
            )}
        </div>
    );
};

// --- EditFeedModal Component ---
const EditFeedModal = ({ record, onClose, onSave, supplyInventory }) => {
    const [editedBatchId] = useState(record.batchId);
    const [editedDate, setEditedDate] = useState(record.date);
    const [editedSupplyItemId, setEditedSupplyItemId] = useState(record.supplyItemId);
    const [editedQuantityKg, setEditedQuantityKg] = useState(record.quantityKg);
    const [editedNotes, setEditedNotes] = useState(record.notes || '');
    const [errorMessage, setErrorMessage] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        setErrorMessage('');
        const parsedQuantityKg = parseFloat(editedQuantityKg);
        if (!editedBatchId || !editedDate || !editedSupplyItemId || isNaN(parsedQuantityKg) || parsedQuantityKg <= 0) {
            setErrorMessage("Please fill all required fields correctly (Batch, Date, Feed Type, Quantity).");
            return;
        }
        const updatedData = {
            batchId: editedBatchId,
            date: editedDate,
            supplyItemId: editedSupplyItemId,
            quantityKg: parsedQuantityKg,
            notes: editedNotes
        };
        onSave(updatedData);
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Edit Feed Record</h2>
                {errorMessage && <p className="text-red-600 mb-4">{errorMessage}</p>}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="editFeedDate" className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                        <input
                            type="date"
                            id="editFeedDate"
                            value={editedDate}
                            onChange={(e) => setEditedDate(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editFeedType" className="block text-sm font-medium text-gray-700 mb-1">Feed Type</label>
                        <select
                            id="editFeedType"
                            value={editedSupplyItemId}
                            onChange={(e) => setEditedSupplyItemId(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                        >
                            <option value="">-- Select Feed Type --</option>
                            {supplyInventory.map(item => (
                                <option key={item.id} value={item.id}>{item.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="editQuantityKg" className="block text-sm font-medium text-gray-700 mb-1">Quantity (kg)</label>
                        <input
                            type="number"
                            id="editQuantityKg"
                            value={editedQuantityKg}
                            onChange={(e) => setEditedQuantityKg(e.target.value)}
                            step="0.01"
                            className="w-full p-2 border border-gray-300 rounded-md"
                            min="0.01"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editFeedNotes" className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
                        <textarea
                            id="editFeedNotes"
                            value={editedNotes}
                            onChange={(e) => setEditedNotes(e.target.value)}
                            rows="2"
                            className="w-full p-2 border border-gray-300 rounded-md"
                        ></textarea>
                    </div>
                    <div className="flex justify-end space-x-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-150"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition duration-150"
                        >
                            Save Changes
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- DeleteFeedConfirmModal Component ---
const DeleteFeedConfirmModal = ({ record, onClose, onConfirm, batches, supplyInventory }) => {
    const batchName = batches.find(b => b.id === record.batchId)?.name || record.batchId;
    const feedName = supplyInventory.find(item => item.id === record.supplyItemId)?.name || record.feedTypeName || 'N/A';

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm text-center">
                <h2 className="text-xl font-bold text-gray-800 mb-4">Confirm Deletion</h2>
                <p className="text-gray-700 mb-6">
                    Are you sure you want to delete the feed record for batch "<span className="font-semibold">{batchName}</span>" on {record?.date} ({record?.quantityKg} kg of {feedName})?
                    This action cannot be undone.
                </p>
                <div className="flex justify-center space-x-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-150"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition duration-150"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
};


// --- ExpenseTrackingTab Component ---
const ExpenseTrackingTab = ({ batches, setNotificationMessage, setNotificationType }) => {
    const { db, userId, appId } = useContext(AppContext);
    const [expenseDate, setExpenseDate] = useState('');
    const [expenseCategory, setExpenseCategory] = useState('');
    const [expenseDescription, setExpenseDescription] = useState('');
    const [expenseAmount, setExpenseAmount] = useState('');
    const [selectedSupplyItemId, setSelectedSupplyItemId] = useState('');
    const [supplyQuantityPurchased, setSupplyQuantityPurchased] = useState('');
    const [selectedBatchForChicks, setSelectedBatchForChicks] = useState('');

    const [expenses, setExpenses] = useState([]);
    const [loadingExpenses, setLoadingExpenses] = useState(true);
    const [expenseError, setExpenseError] = useState(null);
    const [isAddExpenseFormExpanded, setIsAddExpenseFormExpanded] = useState(false);

    const [isEditExpenseModalOpen, setIsEditExpenseModalOpen] = useState(false);
    const [expenseToEdit, setExpenseToEdit] = useState(null);
    const [isDeleteExpenseConfirmOpen, setIsDeleteExpenseConfirmOpen] = useState(false);
    const [expenseToDelete, setExpenseToDelete] = useState(null);

    const [supplyInventory, setSupplyInventory] = useState([]);
    const [loadingSupplyInventory, setLoadingSupplyInventory] = useState(true);
    const [supplyInventoryError, setSupplyInventoryError] = useState(null);

    useEffect(() => {
        if (!db || !userId) return;

        setLoadingSupplyInventory(true);
        setSupplyInventoryError(null);

        try {
            const suppliesCollectionPath = `artifacts/${appId}/users/${userId}/supplyInventory`;
            const suppliesCollectionRef = collection(db, suppliesCollectionPath);

            const unsubscribe = onSnapshot(suppliesCollectionRef, (snapshot) => {
                const fetchedSupplies = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                setSupplyInventory(fetchedSupplies);
                setLoadingSupplyInventory(false);
            }, (snapshotError) => {
                console.error("Error fetching supply inventory for expenses:", snapshotError);
                setSupplyInventoryError(`Failed to load supply items: ${snapshotError.message}`);
                setLoadingSupplyInventory(false);
            });

            return () => unsubscribe();
        } catch (fetchError) {
            console.error("Error setting up supply inventory listener for expenses:", fetchError);
            setSupplyInventoryError(`Error setting up supply inventory listener: ${fetchError.message}`);
            setLoadingSupplyInventory(false);
        }
    }, [db, userId, appId]);

    useEffect(() => {
        if (!db || !userId) return;

        setLoadingExpenses(true);
        setExpenseError(null);

        try {
            const expensesCollectionPath = `artifacts/${appId}/users/${userId}/expenses`;
            const expensesCollectionRef = collection(db, expensesCollectionPath);

            const unsubscribe = onSnapshot(expensesCollectionRef, (snapshot) => {
                const fetchedExpenses = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                const sortedExpenses = [...fetchedExpenses].sort((a, b) => {
                    const dateA = a.date ? new Date(a.date) : new Date(0);
                    const dateB = b.date ? new Date(b.date) : new Date(0);
                    return dateB.getTime() - dateA.getTime();
                });
                setExpenses(sortedExpenses);
                setLoadingExpenses(false);
            }, (snapshotError) => {
                console.error("Error fetching expenses:", snapshotError);
                setExpenseError(`Failed to load expenses: ${snapshotError.message}`);
                setLoadingExpenses(false);
            });

            return () => unsubscribe();
        } catch (fetchError) {
            console.error("Error setting up expense listener:", fetchError);
            setExpenseError(`Error setting up expense listener: ${fetchError.message}`);
            setLoadingExpenses(false);
        }
    }, [db, userId, appId]);

    const handleAddExpense = async (e) => {
        e.preventDefault();
        if (!db || !userId) {
            setNotificationMessage("Firebase not initialized or user not authenticated.");
            setNotificationType('error');
            return;
        }
        if (!expenseDate || !expenseCategory || !expenseAmount) {
            setNotificationMessage("Please fill in all required fields: Date, Category, and Amount.");
            setNotificationType('error');
            return;
        }

        const parsedAmount = parseFloat(expenseAmount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            setNotificationMessage("Please enter a valid positive amount for the expense.");
            setNotificationType('error');
            return;
        }

        let finalCategory = expenseCategory; // Default to the selected primary category
        let expenseData = {
            date: expenseDate,
            category: finalCategory, // This will be updated if it's a feed supply
            description: expenseDescription,
            amount: parsedAmount,
            createdAt: serverTimestamp()
        };

        try {
            if (expenseCategory === 'Supply Purchase') {
                if (!selectedSupplyItemId || supplyQuantityPurchased === '') {
                    setNotificationMessage("For 'Supply Purchase', please select a Supply Item and enter Quantity Purchased.");
                    setNotificationType('error');
                    return;
                }
                const parsedSupplyQuantity = parseFloat(supplyQuantityPurchased);
                if (isNaN(parsedSupplyQuantity) || parsedSupplyQuantity <= 0) {
                    setNotificationMessage("Please enter a valid positive quantity for the supply purchase.");
                    setNotificationType('error');
                    return;
                }

                const selectedSupplyItem = supplyInventory.find(item => item.id === selectedSupplyItemId);
                if (!selectedSupplyItem) {
                    setNotificationMessage("Selected supply item not found in inventory.");
                    setNotificationType('error');
                    return;
                }

                // IMPORTANT: If the selected supply item's category (from SupplyInventoryTab) includes 'feed',
                // then set the expense category to the item's name (e.g., "Starter Feed") for COGS reporting.
                // Otherwise, keep it as 'Supply Purchase'.
                if (selectedSupplyItem.category.toLowerCase().includes('feed')) {
                    finalCategory = selectedSupplyItem.name; // Use the specific feed name as the category
                } else {
                    finalCategory = 'Supply Purchase'; // Keep as 'Supply Purchase' for non-feed supplies
                }

                const supplyDocRef = doc(db, `artifacts/${appId}/users/${userId}/supplyInventory`, selectedSupplyItemId);
                await updateDoc(supplyDocRef, {
                    currentStock: selectedSupplyItem.currentStock + parsedSupplyQuantity,
                    updatedAt: serverTimestamp()
                });

                expenseData = {
                    ...expenseData,
                    category: finalCategory, // Update the category based on the logic above
                    supplyItemId: selectedSupplyItemId,
                    supplyItemName: selectedSupplyItem.name,
                    supplyItemUnit: selectedSupplyItem.unit,
                    supplyItemCategory: selectedSupplyItem.category, // Keep original supply category for reference
                    quantityPurchased: parsedSupplyQuantity,
                };
            } else if (expenseCategory === 'Chicks Purchase') {
                if (!selectedBatchForChicks) {
                    setNotificationMessage("For 'Chicks Purchase', please select a batch.");
                    setNotificationType('error');
                    return;
                }
                expenseData = {
                    ...expenseData,
                    batchId: selectedBatchForChicks,
                };
            }

            const expensesCollectionPath = `artifacts/${appId}/users/${userId}/expenses`;
            await addDoc(collection(db, expensesCollectionPath), expenseData);

            setExpenseDate('');
            setExpenseCategory('');
            setExpenseDescription('');
            setExpenseAmount('');
            setSelectedSupplyItemId('');
            setSupplyQuantityPurchased('');
            setSelectedBatchForChicks('');
            setNotificationMessage("Expense recorded successfully!");
            setNotificationType('success');
        } catch (error) {
            console.error("Error adding expense:", error);
            setNotificationMessage(`Failed to record expense: ${error.message}`);
            setNotificationType('error');
        }
    };

    useEffect(() => {
        if (expenseCategory === 'Chicks Purchase' && selectedBatchForChicks && batches.length > 0) {
            const batch = batches.find(b => b.id === selectedBatchForChicks);
            if (batch) {
                const calculatedAmount = batch.purchasedChickCount * batch.chickPrice;
                setExpenseAmount(calculatedAmount.toFixed(2));
                setExpenseDescription(`Purchase of ${batch.purchasedChickCount} chicks for batch: ${batch.name}`);
            }
        } else if (expenseCategory !== 'Chicks Purchase' && expenseCategory !== 'Supply Purchase') {
            setSelectedBatchForChicks('');
            if (expenseDescription.includes("Purchase of") && expenseDescription.includes("chicks for batch")) {
                setExpenseDescription('');
            }
            setExpenseAmount('');
        }
    }, [expenseCategory, selectedBatchForChicks, batches, expenseDescription]);

    const openEditExpenseModal = (expense) => {
        setExpenseToEdit(expense);
        setIsEditExpenseModalOpen(true);
    };

    const openDeleteExpenseConfirm = (expense) => {
        setExpenseToDelete(expense);
        setIsDeleteExpenseConfirmOpen(true);
    };

    // This function would be inside your ExpensesTab component

    const handleSaveEditedExpense = async (updatedData) => {
        // Corrected variable name here
        if (!expenseToEdit) return;
        
        // We need to get the original data before we overwrite it
        const originalExpenseData = expenses.find(exp => exp.id === expenseToEdit.id);
        if (!originalExpenseData) {
            setNotificationMessage("Original expense not found. Cannot update.");
            setNotificationType('error');
            return;
        }

        try {
            // --- INVENTORY UPDATE LOGIC ---
            // Step 1: Adjust inventory based on the ORIGINAL expense data.
            if (originalExpenseData.supplyItemId) {
                const originalSupplyRef = doc(db, `artifacts/${appId}/users/${userId}/supplyInventory`, originalExpenseData.supplyItemId);
                const originalSupplyDoc = await getDoc(originalSupplyRef);
                
                if (originalSupplyDoc.exists()) {
                    const originalSupplyData = originalSupplyDoc.data();
                    const originalQuantity = originalExpenseData.quantityPurchased || 0;
                    const originalCost = originalExpenseData.amount || 0;

                    // Return the original quantity and cost to the inventory
                    await updateDoc(originalSupplyRef, {
                        currentStock: (originalSupplyData.currentStock || 0) + originalQuantity,
                        totalCost: (originalSupplyData.totalCost || 0) - originalCost
                    });
                }
            }

            // Step 2: Adjust inventory based on the NEW expense data.
            if (updatedData.supplyItemId) {
                const newSupplyRef = doc(db, `artifacts/${appId}/users/${userId}/supplyInventory`, updatedData.supplyItemId);
                const newSupplyDoc = await getDoc(newSupplyRef);

                if (newSupplyDoc.exists()) {
                    const newSupplyData = newSupplyDoc.data();
                    const newQuantity = updatedData.quantityPurchased || 0;
                    const newCost = updatedData.amount || 0;

                    // Subtract the new quantity and add the new cost from the inventory
                    await updateDoc(newSupplyRef, {
                        currentStock: (newSupplyData.currentStock || 0) - newQuantity,
                        totalCost: (newSupplyData.totalCost || 0) + newCost
                    });
                }
            }

            // --- EXPENSE UPDATE LOGIC ---
            // Step 3: Update the expense record itself.
            const expenseRef = doc(db, `artifacts/${appId}/users/${userId}/expenses`, expenseToEdit.id);
            await updateDoc(expenseRef, updatedData);

            // Corrected function name here
            setExpenseToEdit(null);
            setNotificationMessage('Expense updated successfully.');
            setNotificationType('success');

        } catch (error) {
            console.error("Error updating expense and inventory:", error);
            setNotificationMessage('Failed to save changes. Please try again.');
            setNotificationType('error');
        }
    };


    const handleDeleteExpense = async () => {
        if (!db || !userId || !expenseToDelete?.id) {
            setNotificationMessage("Firebase not initialized or expense ID missing for deletion.");
            setNotificationType('error');
            return;
        }

        try {
            // Revert inventory deduction if applicable and it was a supply purchase
            if (expenseToDelete.category.toLowerCase().includes('feed') || expenseToDelete.category === 'Supply Purchase') {
                if (expenseToDelete.supplyItemId && expenseToDelete.quantityPurchased) {
                    const supplyDocRef = doc(db, `artifacts/${appId}/users/${userId}/supplyInventory`, expenseToDelete.supplyItemId);
                    const supplySnap = await getDoc(supplyDocRef);
                    if (supplySnap.exists()) {
                        await updateDoc(supplyDocRef, {
                            currentStock: supplySnap.data().currentStock - expenseToDelete.quantityPurchased,
                            updatedAt: serverTimestamp()
                        });
                    } else {
                        console.warn("Supply item not found for deletion reversion:", expenseToDelete.supplyItemId);
                    }
                }
            }

            const expenseDocRef = doc(db, `artifacts/${appId}/users/${userId}/expenses`, expenseToDelete.id);
            await deleteDoc(expenseDocRef);

            setIsDeleteExpenseConfirmOpen(false);
            setExpenseToDelete(null);
            setNotificationMessage("Expense deleted successfully!");
            setNotificationType('success');
        } catch (deleteError) {
            console.error("Error deleting expense:", deleteError);
            setNotificationMessage(`Failed to delete expense: ${deleteError.message}`);
            setNotificationType('error');
        }
    };

    const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);

    const groupedExpenses = expenses.reduce((acc, expense) => {
        const category = expense.category || 'Uncategorized';
        if (!acc[category]) {
            acc[category] = [];
        }
        acc[category].push(expense);
        return acc;
    }, {});

    return (
        <div className="p-6 bg-gray-50 rounded-lg shadow-inner">
            <div className="mb-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
                <h3 className="text-xl font-semibold text-gray-700 mb-2">Overall Expenses Summary</h3>
                <p className="text-lg text-gray-800">
                    <span className="font-semibold">Total Expenses:</span> ${totalExpenses.toFixed(2)}
                </p>
            </div>

            <div className="mb-8 p-6 bg-gray-50 rounded-lg shadow-inner">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-semibold text-gray-700">Record New Expense</h2>
                    <button
                        onClick={() => setIsAddExpenseFormExpanded(!isAddExpenseFormExpanded)}
                        className="p-2 rounded-full bg-gray-200 hover:bg-gray-300 transition duration-150"
                        aria-expanded={isAddExpenseFormExpanded}
                        aria-controls="add-expense-form"
                    >
                        {isAddExpenseFormExpanded ? (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                            </svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                            </svg>
                        )}
                    </button>
                </div>

                {isAddExpenseFormExpanded && (
                    <form onSubmit={handleAddExpense} className="grid grid-cols-1 md:grid-cols-2 gap-4" id="add-expense-form">
                        <div>
                            <label htmlFor="expenseDate" className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                            <input
                                type="date"
                                id="expenseDate"
                                value={expenseDate}
                                onChange={(e) => setExpenseDate(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="expenseCategory" className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                            <select
                                id="expenseCategory"
                                value={expenseCategory}
                                onChange={(e) => {
                                    setExpenseCategory(e.target.value);
                                    if (e.target.value !== 'Supply Purchase') {
                                        setSelectedSupplyItemId('');
                                        setSupplyQuantityPurchased('');
                                    }
                                    if (e.target.value !== 'Chicks Purchase') {
                                        setSelectedBatchForChicks('');
                                    }
                                }}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            >
                                <option value="">-- Select Category --</option>
                                <option value="Supply Purchase">Supply Purchase</option>
                                <option value="Chicks Purchase">Chicks Purchase</option>
                                <option value="Medication">Medication</option>
                                <option value="Utilities">Utilities</option>
                                <option value="Labor">Labor</option>
                                <option value="Equipment">Equipment</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                        {expenseCategory === 'Supply Purchase' && (
                            <>
                                <div>
                                    <label htmlFor="selectedSupplyItem" className="block text-sm font-medium text-gray-700 mb-1">Supply Item</label>
                                    <select
                                        id="selectedSupplyItem"
                                        value={selectedSupplyItemId}
                                        onChange={(e) => setSelectedSupplyItemId(e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                        required
                                        disabled={loadingSupplyInventory}
                                    >
                                        <option value="">-- Select Supply Item --</option>
                                        {loadingSupplyInventory ? (
                                            <option value="" disabled>Loading supplies...</option>
                                        ) : supplyInventoryError ? (
                                            <option value="" disabled>Error loading supplies</option>
                                        ) : supplyInventory.length === 0 ? (
                                            <option value="" disabled>No supply items added yet</option>
                                        ) : (
                                            supplyInventory.map(item => (
                                                <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>
                                            ))
                                        )}
                                    </select>
                                    {supplyInventoryError && <p className="text-red-600 text-xs mt-1">{supplyInventoryError}</p>}
                                </div>
                                <div>
                                    <label htmlFor="supplyQuantityPurchased" className="block text-sm font-medium text-gray-700 mb-1">Quantity Purchased</label>
                                    <input
                                        type="number"
                                        id="supplyQuantityPurchased"
                                        value={supplyQuantityPurchased}
                                        onChange={(e) => setSupplyQuantityPurchased(e.target.value)}
                                        placeholder="e.g., 50"
                                        step="0.01"
                                        className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                        min="0.01"
                                        required
                                    />
                                </div>
                            </>
                        )}
                        {expenseCategory === 'Chicks Purchase' && (
                            <div>
                                <label htmlFor="selectBatchForChicks" className="block text-sm font-medium text-gray-700 mb-1">Select Batch</label>
                                <select
                                    id="selectBatchForChicks"
                                    value={selectedBatchForChicks}
                                    onChange={(e) => setSelectedBatchForChicks(e.target.value)}
                                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                    required
                                >
                                    <option value="">-- Select a Batch --</option>
                                    {batches.map(batch => (
                                        <option key={batch.id} value={batch.id}>{batch.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div className="md:col-span-2">
                            <label htmlFor="expenseDescription" className="block text-sm font-medium text-gray-700 mb-1">Description (Optional)</label>
                            <textarea
                                id="expenseDescription"
                                value={expenseDescription}
                                onChange={(e) => setExpenseDescription(e.target.value)}
                                placeholder="e.g., Purchased 2 bags of starter feed"
                                rows="2"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                disabled={expenseCategory === 'Chicks Purchase' && selectedBatchForChicks !== ''}
                            ></textarea>
                        </div>
                        <div>
                            <label htmlFor="expenseAmount" className="block text-sm font-medium text-gray-700 mb-1">Amount ($)</label>
                            <input
                                type="number"
                                id="expenseAmount"
                                value={expenseAmount}
                                onChange={(e) => setExpenseAmount(e.target.value)}
                                placeholder="e.g., 30.50"
                                step="0.01"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                min="0"
                                required
                                disabled={expenseCategory === 'Chicks Purchase' && selectedBatchForChicks !== ''}
                            />
                        </div>
                        <div className="md:col-span-2">
                            <button
                                type="submit"
                                className="w-full bg-purple-600 text-white py-2 px-4 rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition duration-200 ease-in-out shadow-md"
                            >
                                Record Expense
                            </button>
                        </div>
                    </form>
                )}
            </div>

            <h2 className="text-2xl font-semibold text-gray-700 mb-4">Expense History</h2>
            {expenseError && <p className="text-red-600 mb-4">{expenseError}</p>}
            {loadingExpenses ? (
                <p className="text-gray-500 text-center py-8">Loading expenses...</p>
            ) : Object.keys(groupedExpenses).length === 0 ? (
                <p className="text-gray-500 text-center py-8">No expenses recorded yet.</p>
            ) : (
                <div className="space-y-6">
                    {Object.entries(groupedExpenses).map(([category, records]) => (
                        <div key={category} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                            <h3 className="text-lg font-bold text-gray-800 mb-3 capitalize">{category}</h3>
                            <ul className="divide-y divide-gray-200">
                                {records.map(record => (
                                    <li key={record.id} className="py-3 flex justify-between items-center">
                                        <div>
                                            <p className="text-sm text-gray-800">
                                                <span className="font-semibold">Date:</span> {record.date}
                                            </p>
                                            <p className="text-sm text-gray-800">
                                                <span className="font-semibold">Amount:</span> ${record.amount.toFixed(2)}
                                            </p>
                                            {record.description && (
                                                <p className="text-xs text-gray-600">
                                                    <span className="font-semibold">Description:</span> {record.description}
                                                </p>
                                            )}
                                            {record.supplyItemName && (
                                                <p className="text-xs text-gray-600">
                                                    <span className="font-semibold">Item:</span> {record.supplyItemName} ({record.quantityPurchased?.toFixed(2)} {record.supplyItemUnit})
                                                </p>
                                            )}
                                            {record.batchId && (
                                                <p className="text-xs text-gray-600">
                                                    <span className="font-semibold">Batch:</span> {batches.find(b => b.id === record.batchId)?.name || record.batchId}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex space-x-2">
                                            <button
                                                onClick={() => openEditExpenseModal(record)}
                                                className="text-blue-600 hover:text-blue-800 text-sm px-3 py-1 rounded-md border border-blue-600 hover:border-blue-800 transition duration-150"
                                            >
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => openDeleteExpenseConfirm(record)}
                                                className="text-red-600 hover:text-red-800 text-sm px-3 py-1 rounded-md border border-red-600 hover:border-red-800 transition duration-150"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            )}

            {isEditExpenseModalOpen && (
                <EditExpenseModal
                    expense={expenseToEdit}
                    onClose={() => setIsEditExpenseModalOpen(false)}
                    onSave={handleSaveEditedExpense}
                    supplyInventory={supplyInventory}
                    batches={batches}
                />
            )}

            {isDeleteExpenseConfirmOpen && (
                <DeleteExpenseConfirmModal
                    expense={expenseToDelete}
                    onClose={() => setIsDeleteExpenseConfirmOpen(false)}
                    onConfirm={handleDeleteExpense}
                />
            )}
        </div>
    );
};

// --- EditExpenseModal Component ---
const EditExpenseModal = ({ expense, onClose, onSave, supplyInventory, batches }) => {
    const [editedDate, setEditedDate] = useState(expense.date);
    const [editedCategory, setEditedCategory] = useState(expense.category);
    const [editedDescription, setEditedDescription] = useState(expense.description || '');
    const [editedAmount, setEditedAmount] = useState(expense.amount);
    const [editedSupplyItemId, setEditedSupplyItemId] = useState(expense.supplyItemId || '');
    const [editedSupplyQuantityPurchased, setEditedSupplyQuantityPurchased] = useState(expense.quantityPurchased || '');
    const [editedBatchId, setEditedBatchId] = useState(expense.batchId || '');
    const [errorMessage, setErrorMessage] = useState('');

    // Determine if the current expense is a 'feed' type based on its saved category
    const isCurrentExpenseFeed = expense.category.toLowerCase().includes('feed');

    // Effect to set initial state for supply item dropdown if it's a supply purchase
    useEffect(() => {
        if (expense.supplyItemId) {
            setEditedSupplyItemId(expense.supplyItemId);
            setEditedSupplyQuantityPurchased(expense.quantityPurchased);
        }
    }, [expense.supplyItemId, expense.quantityPurchased]);


    const handleSubmit = (e) => {
        e.preventDefault();
        setErrorMessage('');

        const parsedAmount = parseFloat(editedAmount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            setErrorMessage("Please enter a valid positive amount for the expense.");
            return;
        }

        let finalCategoryForSave = editedCategory; // Start with the selected category from the dropdown

        // If the selected category is 'Supply Purchase' or was originally a feed item
        if (editedCategory === 'Supply Purchase' || isCurrentExpenseFeed) {
            if (!editedSupplyItemId || editedSupplyQuantityPurchased === '') {
                setErrorMessage("For 'Supply Purchase' or Feed items, please select a Supply Item and enter Quantity Purchased.");
                return;
            }
            const parsedSupplyQuantity = parseFloat(editedSupplyQuantityPurchased);
            if (isNaN(parsedSupplyQuantity) || parsedSupplyQuantity <= 0) {
                setErrorMessage("Please enter a valid positive quantity for the supply purchase.");
                return;
            }

            const selectedSupplyItem = supplyInventory.find(item => item.id === editedSupplyItemId);
            if (!selectedSupplyItem) {
                setErrorMessage("Selected supply item not found in inventory.");
                return;
            }

            // Determine the final category to save based on the selected supply item's type
            if (selectedSupplyItem.category.toLowerCase().includes('feed')) {
                finalCategoryForSave = selectedSupplyItem.name; // Use the specific feed name as the category
            } else {
                finalCategoryForSave = 'Supply Purchase'; // Keep as 'Supply Purchase' for non-feed supplies
            }
        }

        const updatedData = {
            date: editedDate,
            category: finalCategoryForSave, // Use the determined category
            description: editedDescription,
            amount: parsedAmount,
            supplyItemId: (editedCategory === 'Supply Purchase' || isCurrentExpenseFeed) ? editedSupplyItemId : null,
            supplyItemName: (editedCategory === 'Supply Purchase' || isCurrentExpenseFeed) ? supplyInventory.find(item => item.id === editedSupplyItemId)?.name : null,
            supplyItemUnit: (editedCategory === 'Supply Purchase' || isCurrentExpenseFeed) ? supplyInventory.find(item => item.id === editedSupplyItemId)?.unit : null,
            supplyItemCategory: (editedCategory === 'Supply Purchase' || isCurrentExpenseFeed) ? supplyInventory.find(item => item.id === editedSupplyItemId)?.category : null,
            quantityPurchased: (editedCategory === 'Supply Purchase' || isCurrentExpenseFeed) ? parseFloat(editedSupplyQuantityPurchased) : null,
            batchId: editedCategory === 'Chicks Purchase' ? editedBatchId : null,
        };
        onSave(updatedData);
    };

    const expenseCategories = [
        'Supply Purchase',
        'Chicks Purchase',
        'Medication',
        'Utilities',
        'Labor',
        'Equipment',
        'Other'
    ];

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Edit Expense</h2>
                {errorMessage && <p className="text-red-600 mb-4">{errorMessage}</p>}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="editExpenseDate" className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                        <input
                            type="date"
                            id="editExpenseDate"
                            value={editedDate}
                            onChange={(e) => setEditedDate(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editExpenseCategory" className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                        <select
                            id="editExpenseCategory"
                            value={editedCategory}
                            onChange={(e) => {
                                setEditedCategory(e.target.value);
                                if (e.target.value !== 'Supply Purchase' && !e.target.value.toLowerCase().includes('feed')) {
                                    setEditedSupplyItemId('');
                                    setEditedSupplyQuantityPurchased('');
                                }
                                if (e.target.value !== 'Chicks Purchase') {
                                    setEditedBatchId('');
                                }
                            }}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                        >
                            {expenseCategories.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                            {/* If the original category was a specific feed name, add it to options if not already there */}
                            {isCurrentExpenseFeed && !expenseCategories.includes(expense.category) && (
                                <option value={expense.category}>{expense.category}</option>
                            )}
                        </select>
                    </div>
                    {(editedCategory === 'Supply Purchase' || isCurrentExpenseFeed) && (
                        <>
                            <div>
                                <label htmlFor="editSelectedSupplyItem" className="block text-sm font-medium text-gray-700 mb-1">Supply Item</label>
                                <select
                                    id="editSelectedSupplyItem"
                                    value={editedSupplyItemId}
                                    onChange={(e) => setEditedSupplyItemId(e.target.value)}
                                    className="w-full p-2 border border-gray-300 rounded-md"
                                    required
                                >
                                    <option value="">-- Select Supply Item --</option>
                                    {supplyInventory.map(item => (
                                        <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="editSupplyQuantityPurchased" className="block text-sm font-medium text-gray-700 mb-1">Quantity Purchased</label>
                                <input
                                    type="number"
                                    id="editSupplyQuantityPurchased"
                                    value={editedSupplyQuantityPurchased}
                                    onChange={(e) => setEditedSupplyQuantityPurchased(e.target.value)}
                                    step="0.01"
                                    className="w-full p-2 border border-gray-300 rounded-md"
                                    min="0.01"
                                    required
                                />
                            </div>
                        </>
                    )}
                    {editedCategory === 'Chicks Purchase' && (
                        <div>
                            <label htmlFor="editSelectBatchForChicks" className="block text-sm font-medium text-gray-700 mb-1">Select Batch</label>
                            <select
                                id="editSelectBatchForChicks"
                                value={editedBatchId}
                                onChange={(e) => setEditedBatchId(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md"
                                required
                            >
                                <option value="">-- Select a Batch --</option>
                                {batches.map(batch => (
                                    <option key={batch.id} value={batch.id}>{batch.name}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div className="md:col-span-2">
                        <label htmlFor="editExpenseDescription" className="block text-sm font-medium text-gray-700 mb-1">Description (Optional)</label>
                        <textarea
                            id="editExpenseDescription"
                            value={editedDescription}
                            onChange={(e) => setEditedDescription(e.target.value)}
                            rows="2"
                            className="w-full p-2 border border-gray-300 rounded-md"
                        ></textarea>
                    </div>
                    <div>
                        <label htmlFor="editExpenseAmount" className="block text-sm font-medium text-gray-700 mb-1">Amount ($)</label>
                        <input
                            type="number"
                            id="editExpenseAmount"
                            value={editedAmount}
                            onChange={(e) => setEditedAmount(e.target.value)}
                            step="0.01"
                            className="w-full p-2 border border-gray-300 rounded-md"
                            min="0"
                            required
                        />
                    </div>
                    <div className="flex justify-end space-x-3 mt-6 md:col-span-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-150"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition duration-150"
                        >
                            Save Changes
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- DeleteExpenseConfirmModal Component ---
const DeleteExpenseConfirmModal = ({ expense, onClose, onConfirm }) => {
    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm text-center">
                <h2 className="text-xl font-bold text-gray-800 mb-4">Confirm Deletion</h2>
                <p className="text-gray-700 mb-6">
                    Are you sure you want to delete the expense for "<span className="font-semibold capitalize">{expense?.category}</span>" on {expense?.date} for ${expense?.amount?.toFixed(2)}?
                    This action cannot be undone.
                </p>
                <div className="flex justify-center space-x-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-150"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition duration-150"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
};


// --- SupplyInventoryTab Component ---
const SupplyInventoryTab = ({ setNotificationMessage, setNotificationType }) => {
    const { db, userId, appId } = useContext(AppContext);
    const [supplies, setSupplies] = useState([]);
    const [loadingSupplies, setLoadingSupplies] = useState(true);
    const [supplyError, setSupplyError] = useState(null);

    // State for Add New Supply Form
    const [supplyName, setSupplyName] = useState('');
    const [supplyUnit, setSupplyUnit] = useState('');
    const [currentStock, setCurrentStock] = useState('');
    const [bufferStock, setBufferStock] = useState('');
    const [supplyCategory, setSupplyCategory] = useState(''); // This is the category for the supply item itself
    const [isAddSupplyFormExpanded, setIsAddSupplyFormExpanded] = useState(false);

    // State for Consume Other Supplies Form
    const [isConsumeOtherSupplyFormExpanded, setIsConsumeOtherSupplyFormExpanded] = useState(false);
    const [consumeSupplyDate, setConsumeSupplyDate] = useState(new Date().toISOString().split('T')[0]); // Default to today's date
    const [selectedSupplyIdForConsumption, setSelectedSupplyIdForConsumption] = useState('');
    const [consumptionQuantity, setConsumptionQuantity] = useState('');
    const [consumptionNotes, setConsumptionNotes] = useState('');

    // State for Modals
    const [isEditSupplyModalOpen, setIsEditSupplyModalOpen] = useState(false);
    const [supplyToEdit, setSupplyToEdit] = useState(null);
    const [isDeleteSupplyConfirmOpen, setIsDeleteSupplyConfirmOpen] = useState(false);
    const [supplyToDelete, setSupplyToDelete] = useState(null);

    const supplyCategories = [
        'Feed',
        'Medication',
        'Heating',
        'Vaccine',
        'Equipment',
        'Cleaning Supplies',
        'Other'
    ];

    // Categories whose consumption is handled elsewhere, so they should be excluded from "Consume Other Supplies"
    const excludedConsumptionCategories = ['Feed', 'Medication', 'Vaccine'];

    // Filtered list of supplies for the "Consume Other Supplies" form
    const consumableOtherSupplies = supplies.filter(supply =>
        !excludedConsumptionCategories.includes(supply.category)
    );

    useEffect(() => {
        if (!db || !userId) return;

        setLoadingSupplies(true);
        setSupplyError(null);

        try {
            const suppliesCollectionPath = `artifacts/${appId}/users/${userId}/supplyInventory`;
            const suppliesCollectionRef = collection(db, suppliesCollectionPath);

            const unsubscribe = onSnapshot(suppliesCollectionRef, (snapshot) => {
                const fetchedSupplies = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                setSupplies(fetchedSupplies);
                setLoadingSupplies(false);
            }, (snapshotError) => {
                console.error("Error fetching supplies:", snapshotError);
                setSupplyError(`Failed to load supplies: ${snapshotError.message}`);
                setLoadingSupplies(false);
            });

            return () => unsubscribe();
        } catch (fetchError) {
            console.error("Error setting up supplies listener:", fetchError);
            setSupplyError(`Error setting up supplies listener: ${fetchError.message}`);
            setLoadingSupplies(false);
        }
    }, [db, userId, appId]);

    // Effect for low buffer stock notification
    useEffect(() => {
        if (supplies.length > 0) {
            const lowStockItems = supplies.filter(item =>
                item.bufferStock > 0 && item.currentStock <= item.bufferStock
            );

            if (lowStockItems.length > 0) {
                const itemNames = lowStockItems.map(item => item.name).join(', ');
                setNotificationMessage(`Low stock alert: ${itemNames} are at or below buffer levels!`);
                setNotificationType('warning');
            } else {
                setNotificationMessage(null);
                setNotificationType(null);
            }
        }
    }, [supplies, setNotificationMessage, setNotificationType]);

    const handleAddSupply = async (e) => {
        e.preventDefault();
        if (!db || !userId) {
            setNotificationMessage("Firebase not initialized or user not authenticated.");
            setNotificationType('error');
            return;
        }
        if (!supplyName || !supplyUnit || currentStock === '' || !supplyCategory) {
            setNotificationMessage("Please fill in all required fields: Name, Unit, Current Stock, and Category.");
            setNotificationType('error');
            return;
        }

        const parsedCurrentStock = parseFloat(currentStock);
        const parsedBufferStock = parseFloat(bufferStock || '0');

        if (isNaN(parsedCurrentStock) || parsedCurrentStock < 0) {
            setNotificationMessage("Please enter a valid non-negative number for Current Stock.");
            setNotificationType('error');
            return;
        }
        if (isNaN(parsedBufferStock) || parsedBufferStock < 0) {
            setNotificationMessage("Please enter a valid non-negative number for Buffer Stock.");
            setNotificationType('error');
            return;
        }

        try {
            const suppliesCollectionPath = `artifacts/${appId}/users/${userId}/supplyInventory`;
            await addDoc(collection(db, suppliesCollectionPath), {
                name: supplyName,
                unit: supplyUnit,
                currentStock: parsedCurrentStock,
                bufferStock: parsedBufferStock,
                category: supplyCategory,
                createdAt: serverTimestamp()
            });

            setSupplyName('');
            setSupplyUnit('');
            setCurrentStock('');
            setBufferStock('');
            setSupplyCategory('');
            setNotificationMessage("Supply item added successfully!");
            setNotificationType('success');
        } catch (error) {
            console.error("Error adding supply item:", error);
            setNotificationMessage(`Failed to add supply item: ${error.message}`);
            setNotificationType('error');
        }
    };

    // --- New Function: Handle Consume Other Supply ---
    const handleConsumeOtherSupply = async (e) => {
        e.preventDefault();
        if (!db || !userId) {
            setNotificationMessage("Firebase not initialized or user not authenticated.");
            setNotificationType('error');
            return;
        }
        if (!selectedSupplyIdForConsumption || consumptionQuantity === '' || !consumeSupplyDate) {
            setNotificationMessage("Please select a supply item, enter quantity, and date.");
            setNotificationType('error');
            return;
        }

        const parsedConsumptionQuantity = parseFloat(consumptionQuantity);
        if (isNaN(parsedConsumptionQuantity) || parsedConsumptionQuantity <= 0) {
            setNotificationMessage("Please enter a valid positive number for Quantity Consumed.");
            setNotificationType('error');
            return;
        }

        const supplyToConsume = supplies.find(s => s.id === selectedSupplyIdForConsumption);
        if (!supplyToConsume) {
            setNotificationMessage("Selected supply item not found.");
            setNotificationType('error');
            return;
        }

        if (parsedConsumptionQuantity > supplyToConsume.currentStock) {
            setNotificationMessage("Consumption quantity cannot exceed current stock.");
            setNotificationType('error');
            return;
        }

        const newStock = supplyToConsume.currentStock - parsedConsumptionQuantity;

        try {
            // 1. Update the supply item's current stock
            const supplyDocRef = doc(db, `artifacts/${appId}/users/${userId}/supplyInventory`, selectedSupplyIdForConsumption);
            await updateDoc(supplyDocRef, {
                currentStock: newStock,
                updatedAt: serverTimestamp() // Add an updatedAt timestamp
            });

            // 2. Record the consumption event
            const consumptionCollectionPath = `artifacts/${appId}/users/${userId}/supplyConsumption`;
            await addDoc(collection(db, consumptionCollectionPath), {
                supplyId: selectedSupplyIdForConsumption,
                supplyName: supplyToConsume.name,
                supplyCategory: supplyToConsume.category, // Save the category for consumption record
                quantityConsumed: parsedConsumptionQuantity,
                unit: supplyToConsume.unit,
                consumptionDate: consumeSupplyDate,
                notes: consumptionNotes,
                createdAt: serverTimestamp()
            });

            setSelectedSupplyIdForConsumption('');
            setConsumptionQuantity('');
            setConsumptionNotes('');
            setConsumeSupplyDate(new Date().toISOString().split('T')[0]); // Reset date to today
            setNotificationMessage("Supply consumption recorded successfully!");
            setNotificationType('success');
        } catch (error) {
            console.error("Error recording supply consumption:", error);
            setNotificationMessage(`Failed to record supply consumption: ${error.message}`);
            setNotificationType('error');
        }
    };

    const openEditSupplyModal = (supply) => {
        setSupplyToEdit(supply);
        setIsEditSupplyModalOpen(true);
    };

    const handleSaveEditedSupply = async (updatedSupplyData) => {
        if (!db || !userId || !supplyToEdit?.id) {
            setNotificationMessage("Firebase not initialized or supply ID missing for update.");
            setNotificationType('error');
            return;
        }

        const parsedCurrentStock = parseFloat(updatedSupplyData.currentStock);
        const parsedBufferStock = parseFloat(updatedSupplyData.bufferStock || '0');

        if (isNaN(parsedCurrentStock) || parsedCurrentStock < 0 || isNaN(parsedBufferStock) || parsedBufferStock < 0) {
            setNotificationMessage("Please enter valid non-negative numbers for stock levels.");
            setNotificationType('error');
            return;
        }

        try {
            const supplyDocRef = doc(db, `artifacts/${appId}/users/${userId}/supplyInventory`, supplyToEdit.id);
            await updateDoc(supplyDocRef, {
                name: updatedSupplyData.name,
                unit: updatedSupplyData.unit,
                currentStock: parsedCurrentStock,
                bufferStock: parsedBufferStock,
                category: updatedSupplyData.category,
                updatedAt: serverTimestamp()
            });

            setIsEditSupplyModalOpen(false);
            setSupplyToEdit(null);
            setNotificationMessage("Supply item updated successfully!");
            setNotificationType('success');
        } catch (updateError) {
            console.error("Error updating supply item:", updateError);
            setNotificationMessage(`Failed to update supply item: ${updateError.message}`);
            setNotificationType('error');
        }
    };

    const openDeleteSupplyConfirm = (supply) => {
        setSupplyToDelete(supply);
        setIsDeleteSupplyConfirmOpen(true);
    };

    const handleDeleteSupply = async () => {
        if (!db || !userId || !supplyToDelete?.id) {
            setNotificationMessage("Firebase not initialized or supply ID missing for deletion.");
            setNotificationType('error');
            return;
        }

        try {
            const supplyDocRef = doc(db, `artifacts/${appId}/users/${userId}/supplyInventory`, supplyToDelete.id);
            await deleteDoc(supplyDocRef);

            setIsDeleteSupplyConfirmOpen(false);
            setSupplyToDelete(null);
            setNotificationMessage("Supply item deleted successfully!");
            setNotificationType('success');
        } catch (deleteError) {
            console.error("Error deleting supply item:", deleteError);
            setNotificationMessage(`Failed to delete supply item: ${deleteError.message}`);
            setNotificationType('error');
        }
    };

    const groupedSupplies = supplies.reduce((acc, supply) => {
        const category = supply.category || 'Uncategorized';
        if (!acc[category]) {
            acc[category] = [];
        }
        acc[category].push(supply);
        return acc;
    }, {});

    return (
        <div className="p-6 bg-gray-50 rounded-lg shadow-inner">
            {/* Add New Supply Item Form */}
            <div className="mb-8 p-6 bg-gray-50 rounded-lg shadow-inner">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-semibold text-gray-700">Add New Supply Item</h2>
                    <button
                        onClick={() => setIsAddSupplyFormExpanded(!isAddSupplyFormExpanded)}
                        className="p-2 rounded-full bg-gray-200 hover:bg-gray-300 transition duration-150"
                        aria-expanded={isAddSupplyFormExpanded}
                        aria-controls="add-supply-form"
                    >
                        {isAddSupplyFormExpanded ? (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                            </svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                            </svg>
                        )}
                    </button>
                </div>

                {isAddSupplyFormExpanded && (
                    <form onSubmit={handleAddSupply} className="grid grid-cols-1 md:grid-cols-2 gap-4" id="add-supply-form">
                        <div>
                            <label htmlFor="supplyName" className="block text-sm font-medium text-gray-700 mb-1">Supply Name</label>
                            <input
                                type="text"
                                id="supplyName"
                                value={supplyName}
                                onChange={(e) => setSupplyName(e.target.value)}
                                placeholder="e.g., Starter Feed"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="supplyUnit" className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                            <input
                                type="text"
                                id="supplyUnit"
                                value={supplyUnit}
                                onChange={(e) => setSupplyUnit(e.target.value)}
                                placeholder="e.g., kg, bag, liter"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="currentStock" className="block text-sm font-medium text-gray-700 mb-1">Current Stock</label>
                            <input
                                type="number"
                                id="currentStock"
                                value={currentStock}
                                onChange={(e) => setCurrentStock(e.target.value)}
                                placeholder="e.g., 100"
                                step="0.01"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                min="0"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="bufferStock" className="block text-sm font-medium text-gray-700 mb-1">Buffer Stock (Optional)</label>
                            <input
                                type="number"
                                id="bufferStock"
                                value={bufferStock}
                                onChange={(e) => setBufferStock(e.target.value)}
                                placeholder="e.g., 20"
                                step="0.01"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                min="0"
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="supplyCategory" className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                            <select
                                id="supplyCategory"
                                value={supplyCategory}
                                onChange={(e) => setSupplyCategory(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            >
                                <option value="">-- Select Category --</option>
                                {supplyCategories.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                        </div>
                        <div className="md:col-span-2">
                            <button
                                type="submit"
                                className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition duration-200 ease-in-out shadow-md"
                            >
                                Add Supply Item
                            </button>
                        </div>
                    </form>
                )}
            </div>

            {/* --- New Section: Consume Other Supplies --- */}
            <div className="mb-8 p-6 bg-gray-50 rounded-lg shadow-inner">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-semibold text-gray-700">Consume Other Supplies</h2>
                    <button
                        onClick={() => setIsConsumeOtherSupplyFormExpanded(!isConsumeOtherSupplyFormExpanded)}
                        className="p-2 rounded-full bg-gray-200 hover:bg-gray-300 transition duration-150"
                        aria-expanded={isConsumeOtherSupplyFormExpanded}
                        aria-controls="consume-other-supply-form"
                    >
                        {isConsumeOtherSupplyFormExpanded ? (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                            </svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                            </svg>
                        )}
                    </button>
                </div>

                {isConsumeOtherSupplyFormExpanded && (
                    <form onSubmit={handleConsumeOtherSupply} className="grid grid-cols-1 md:grid-cols-2 gap-4" id="consume-other-supply-form">
                        <div>
                            <label htmlFor="consumeSupplyDate" className="block text-sm font-medium text-gray-700 mb-1">Consumption Date</label>
                            <input
                                type="date"
                                id="consumeSupplyDate"
                                value={consumeSupplyDate}
                                onChange={(e) => setConsumeSupplyDate(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="selectedSupplyIdForConsumption" className="block text-sm font-medium text-gray-700 mb-1">Supply Item</label>
                            <select
                                id="selectedSupplyIdForConsumption"
                                value={selectedSupplyIdForConsumption}
                                onChange={(e) => setSelectedSupplyIdForConsumption(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            >
                                <option value="">-- Select Supply --</option>
                                {consumableOtherSupplies.length === 0 ? (
                                    <option value="" disabled>No other supplies available</option>
                                ) : (
                                    consumableOtherSupplies.map(supply => (
                                        <option key={supply.id} value={supply.id}>
                                            {supply.name} ({supply.currentStock} {supply.unit})
                                        </option>
                                    ))
                                )}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="consumptionQuantity" className="block text-sm font-medium text-gray-700 mb-1">Quantity Consumed</label>
                            <input
                                type="number"
                                id="consumptionQuantity"
                                value={consumptionQuantity}
                                onChange={(e) => setConsumptionQuantity(e.target.value)}
                                placeholder="e.g., 5"
                                step="0.01"
                                min="0.01"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="consumptionNotes" className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
                            <textarea
                                id="consumptionNotes"
                                value={consumptionNotes}
                                onChange={(e) => setConsumptionNotes(e.target.value)}
                                placeholder="e.g., Used for general cleaning"
                                rows="2"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500 resize-y"
                            ></textarea>
                        </div>
                        <div className="md:col-span-2">
                            <button
                                type="submit"
                                className="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition duration-200 ease-in-out shadow-md"
                            >
                                Record Consumption
                            </button>
                        </div>
                    </form>
                )}
            </div>

            {/* Current Supply Inventory Display (remains the same) */}
            <h2 className="text-2xl font-semibold text-gray-700 mb-4">Current Supply Inventory</h2>
            {supplyError && <p className="text-red-600 mb-4">{supplyError}</p>}
            {loadingSupplies ? (
                <p className="text-gray-500 text-center py-8">Loading supplies...</p>
            ) : Object.keys(groupedSupplies).length === 0 ? (
                <p className="text-gray-500 text-center py-8">No supply items added yet.</p>
            ) : (
                <div className="space-y-6">
                    {Object.entries(groupedSupplies).map(([category, records]) => (
                        <div key={category} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                            <h3 className="text-lg font-bold text-gray-800 mb-3 capitalize">{category}</h3>
                            <ul className="divide-y divide-gray-200">
                                {records.map(record => {
                                    let stockStatusText = '';
                                    let stockStatusColor = 'text-gray-600';

                                    if (record.bufferStock > 0) {
                                        if (record.currentStock <= record.bufferStock) {
                                            stockStatusText = 'Low Stock';
                                            stockStatusColor = 'text-red-600 font-semibold';
                                        } else {
                                            stockStatusText = 'OK';
                                            stockStatusColor = 'text-green-600';
                                        }
                                    } else {
                                        stockStatusText = 'No Buffer Set';
                                        stockStatusColor = 'text-gray-500';
                                    }

                                    return (
                                        <li key={record.id} className="py-3 flex justify-between items-center">
                                            <div>
                                                <p className="text-sm text-gray-800">
                                                    <span className="font-semibold">Name:</span> {record.name}
                                                </p>
                                                <p className="text-sm text-gray-800">
                                                    <span className="font-semibold">Stock:</span> {record.currentStock.toFixed(2)} {record.unit}
                                                </p>
                                                {record.bufferStock > 0 && (
                                                    <p className="text-sm text-gray-800">
                                                        <span className="font-semibold">Buffer:</span> {record.bufferStock.toFixed(2)} {record.unit}
                                                    </p>
                                                )}
                                                <p className={`text-sm ${stockStatusColor}`}>
                                                    <span className="font-semibold">Status:</span> {stockStatusText}
                                                </p>
                                            </div>
                                            <div className="flex space-x-2">
                                                <button
                                                    onClick={() => openEditSupplyModal(record)}
                                                    className="text-blue-600 hover:text-blue-800 text-sm px-3 py-1 rounded-md border border-blue-600 hover:border-blue-800 transition duration-150"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => openDeleteSupplyConfirm(record)}
                                                    className="text-red-600 hover:text-red-800 text-sm px-3 py-1 rounded-md border border-red-600 hover:border-red-800 transition duration-150"
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </div>
            )}

            {/* Modals (remain the same) */}
            {isEditSupplyModalOpen && (
                <EditSupplyModal
                    supply={supplyToEdit}
                    onClose={() => setIsEditSupplyModalOpen(false)}
                    onSave={handleSaveEditedSupply}
                    supplyCategories={supplyCategories}
                />
            )}

            {isDeleteSupplyConfirmOpen && (
                <DeleteSupplyConfirmModal
                    supply={supplyToDelete}
                    onClose={() => setIsDeleteSupplyConfirmOpen(false)}
                    onConfirm={handleDeleteSupply}
                />
            )}
        </div>
    );
};

// --- EditSupplyModal Component ---
const EditSupplyModal = ({ supply, onClose, onSave, supplyCategories }) => {
    const [editedName, setEditedName] = useState(supply.name);
    const [editedUnit, setEditedUnit] = useState(supply.unit);
    const [editedCurrentStock, setEditedCurrentStock] = useState(supply.currentStock);
    const [editedBufferStock, setEditedBufferStock] = useState(supply.bufferStock || '');
    const [editedCategory, setEditedCategory] = useState(supply.category);
    const [errorMessage, setErrorMessage] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        setErrorMessage('');

        const parsedCurrentStock = parseFloat(editedCurrentStock);
        const parsedBufferStock = parseFloat(editedBufferStock || '0');

        if (!editedName || !editedUnit || isNaN(parsedCurrentStock) || parsedCurrentStock < 0 || !editedCategory) {
            setErrorMessage("Please fill all required fields correctly (Name, Unit, Current Stock, Category).");
            return;
        }
        if (isNaN(parsedBufferStock) || parsedBufferStock < 0) {
            setErrorMessage("Please enter a valid non-negative number for Buffer Stock.");
            return;
        }

        const updatedData = {
            name: editedName,
            unit: editedUnit,
            currentStock: parsedCurrentStock,
            bufferStock: parsedBufferStock,
            category: editedCategory
        };
        onSave(updatedData);
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Edit Supply Item</h2>
                {errorMessage && <p className="text-red-600 mb-4">{errorMessage}</p>}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="editSupplyName" className="block text-sm font-medium text-gray-700 mb-1">Supply Name</label>
                        <input
                            type="text"
                            id="editSupplyName"
                            value={editedName}
                            onChange={(e) => setEditedName(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editSupplyUnit" className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                        <input
                            type="text"
                            id="editSupplyUnit"
                            value={editedUnit}
                            onChange={(e) => setEditedUnit(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editCurrentStock" className="block text-sm font-medium text-gray-700 mb-1">Current Stock</label>
                        <input
                            type="number"
                            id="editCurrentStock"
                            value={editedCurrentStock}
                            onChange={(e) => setEditedCurrentStock(e.target.value)}
                            step="0.01"
                            className="w-full p-2 border border-gray-300 rounded-md"
                            min="0"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editBufferStock" className="block text-sm font-medium text-gray-700 mb-1">Buffer Stock (Optional)</label>
                        <input
                            type="number"
                            id="editBufferStock"
                            value={editedBufferStock}
                            onChange={(e) => setEditedBufferStock(e.target.value)}
                            step="0.01"
                            className="w-full p-2 border border-gray-300 rounded-md"
                            min="0"
                        />
                    </div>
                    <div>
                        <label htmlFor="editSupplyCategory" className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                        <select
                            id="editSupplyCategory"
                            value={editedCategory}
                            onChange={(e) => setEditedCategory(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                        >
                            {supplyCategories.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex justify-end space-x-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-150"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition duration-150"
                        >
                            Save Changes
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- DeleteSupplyConfirmModal Component ---
const DeleteSupplyConfirmModal = ({ supply, onClose, onConfirm }) => {
    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm text-center">
                <h2 className="text-xl font-bold text-gray-800 mb-4">Confirm Deletion</h2>
                <p className="text-gray-700 mb-6">
                    Are you sure you want to delete the supply item "<span className="font-semibold">{supply?.name}</span>" ({supply?.currentStock?.toFixed(2)} {supply?.unit})?
                    This action cannot be undone.
                </p>
                <div className="flex justify-center space-x-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-150"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition duration-150"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
};


// --- WeightTrackingTab Component ---
const WeightTrackingTab = ({ batches, setNotificationMessage, setNotificationType }) => {
    const { db, userId, appId } = useContext(AppContext);
    const [selectedBatchId, setSelectedBatchId] = useState('');
    const [weightDate, setWeightDate] = useState('');
    const [averageWeight, setAverageWeight] = useState(''); // in kg
    const [weightNotes, setWeightNotes] = useState('');
    const [weightRecords, setWeightRecords] = useState([]);
    const [loadingWeights, setLoadingWeights] = useState(true);
    const [weightError, setWeightError] = useState(null);
    const [isRecordWeightFormExpanded, setIsRecordWeightFormExpanded] = useState(false);

    const [isEditWeightModalOpen, setIsEditWeightModalOpen] = useState(false);
    const [weightRecordToEdit, setWeightRecordToEdit] = useState(null);
    const [isDeleteWeightConfirmOpen, setIsDeleteWeightConfirmOpen] = useState(false);
    const [weightRecordToDelete, setWeightRecordToDelete] = useState(null);

    useEffect(() => {
        if (!db || !userId) return;

        setLoadingWeights(true);
        setWeightError(null);

        try {
            const weightCollectionPath = `artifacts/${appId}/users/${userId}/weightRecords`;
            const weightCollectionRef = collection(db, weightCollectionPath);

            const unsubscribe = onSnapshot(weightCollectionRef, (snapshot) => {
                const fetchedRecords = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                const sortedRecords = [...fetchedRecords].sort((a, b) => {
                    const dateA = a.date ? new Date(a.date) : new Date(0);
                    const dateB = b.date ? new Date(b.date) : new Date(0);
                    return dateB.getTime() - dateA.getTime();
                });
                setWeightRecords(sortedRecords);
                setLoadingWeights(false);
            }, (snapshotError) => {
                console.error("Error fetching weight records:", snapshotError);
                setWeightError(`Failed to load weight records: ${snapshotError.message}`);
                setLoadingWeights(false);
            });

            return () => unsubscribe();
        } catch (fetchError) {
            console.error("Error setting up weight listener:", fetchError);
            setWeightError(`Error setting up weight listener: ${fetchError.message}`);
            setLoadingWeights(false);
        }
    }, [db, userId, appId]);

    const handleAddWeight = async (e) => {
        e.preventDefault();
        if (!db || !userId) {
            setNotificationMessage("Firebase not initialized or user not authenticated.");
            setNotificationType('error');
            return;
        }
        if (!selectedBatchId || !weightDate || !averageWeight) {
            setNotificationMessage("Please select a batch, date, and average weight.");
            setNotificationType('error');
            return;
        }

        const parsedAverageWeight = parseFloat(averageWeight);
        if (isNaN(parsedAverageWeight) || parsedAverageWeight <= 0) {
            setNotificationMessage("Please enter a valid positive number for average weight.");
            setNotificationType('error');
            return;
        }

        const selectedBatch = batches.find(b => b.id === selectedBatchId);
        if (!selectedBatch) {
            setNotificationMessage("Selected batch not found.");
            setNotificationType('error');
            return;
        }

        try {
            const weightCollectionPath = `artifacts/${appId}/users/${userId}/weightRecords`;
            await addDoc(collection(db, weightCollectionPath), {
                batchId: selectedBatchId,
                date: weightDate,
                averageWeight: parsedAverageWeight,
                notes: weightNotes,
                createdAt: serverTimestamp()
            });

            const batchDocRef = doc(db, `artifacts/${appId}/users/${userId}/broilerBatches`, selectedBatchId);
            const newCurrentWeight = parsedAverageWeight; // Update current weight for the batch
            let newFCR = 0;
            if (selectedBatch.feedConsumed > 0 && selectedBatch.currentCount > 0 && newCurrentWeight > 0) {
                // FCR = Total Feed Consumed / (Average Weight * Current Count)
                newFCR = selectedBatch.feedConsumed / (newCurrentWeight * selectedBatch.currentCount);
            }

            await updateDoc(batchDocRef, {
                currentWeight: newCurrentWeight,
                feedConversionRatio: newFCR
            });

            setSelectedBatchId('');
            setWeightDate('');
            setAverageWeight('');
            setWeightNotes('');
            setNotificationMessage("Weight recorded and batch updated successfully!");
            setNotificationType('success');
        } catch (addError) {
            console.error("Error adding weight record or updating batch:", addError);
            setNotificationMessage(`Failed to record weight: ${addError.message}`);
            setNotificationType('error');
        }
    };

    const openEditWeightModal = (record) => {
        setWeightRecordToEdit(record);
        setIsEditWeightModalOpen(true);
    };

    const handleSaveEditedWeight = async (updatedRecordData) => {
        if (!db || !userId || !weightRecordToEdit?.id) {
            setNotificationMessage("Firebase not initialized or weight record ID missing for update.");
            setNotificationType('error');
            return;
        }

        const newAverageWeight = parseFloat(updatedRecordData.averageWeight);
        const batchId = updatedRecordData.batchId;

        if (isNaN(newAverageWeight) || newAverageWeight <= 0) {
            setNotificationMessage("Please enter a valid positive number for average weight.");
            setNotificationType('error');
            return;
        }

        try {
            const weightRecordDocRef = doc(db, `artifacts/${appId}/users/${userId}/weightRecords`, weightRecordToEdit.id);
            await updateDoc(weightRecordDocRef, {
                batchId: updatedRecordData.batchId,
                date: updatedRecordData.date,
                averageWeight: newAverageWeight,
                notes: updatedRecordData.notes,
                updatedAt: serverTimestamp()
            });

            const batchDocRef = doc(db, `artifacts/${appId}/users/${userId}/broilerBatches`, batchId);
            const batchSnap = await getDoc(batchDocRef);
            if (batchSnap.exists()) {
                const selectedBatch = batchSnap.data();
                let newFCR = 0;
                if (selectedBatch.feedConsumed > 0 && selectedBatch.currentCount > 0 && newAverageWeight > 0) {
                    newFCR = selectedBatch.feedConsumed / (newAverageWeight * selectedBatch.currentCount);
                }
                await updateDoc(batchDocRef, {
                    currentWeight: newAverageWeight,
                    feedConversionRatio: newFCR
                });
            } else {
                console.warn("Batch not found for weight record update:", batchId);
            }

            setIsEditWeightModalOpen(false);
            setWeightRecordToEdit(null);
            setNotificationMessage("Weight record updated successfully!");
            setNotificationType('success');
        } catch (updateError) {
            console.error("Error updating weight record:", updateError);
            setNotificationMessage(`Failed to update weight record: ${updateError.message}`);
            setNotificationType('error');
        }
    };

    const openDeleteWeightConfirm = (record) => {
        setWeightRecordToDelete(record);
        setIsDeleteWeightConfirmOpen(true);
    };

    const handleDeleteWeight = async () => {
        if (!db || !userId || !weightRecordToDelete?.id) {
            setNotificationMessage("Firebase not initialized or weight record ID missing for deletion.");
            setNotificationType('error');
            return;
        }

        const batchId = weightRecordToDelete.batchId;

        try {
            const weightRecordDocRef = doc(db, `artifacts/${appId}/users/${userId}/weightRecords`, weightRecordToDelete.id);
            await deleteDoc(weightRecordDocRef);

            // Optionally, reset batch currentWeight and FCR if this was the latest record
            // For simplicity, we'll just delete the record. Re-calculating batch weight/FCR
            // based on remaining records would require more complex logic (e.g., finding latest weight record)
            const batchDocRef = doc(db, `artifacts/${appId}/users/${userId}/broilerBatches`, batchId);
            const batchSnap = await getDoc(batchDocRef);
            if (batchSnap.exists()) {
                const selectedBatch = batchSnap.data();
                // Find the latest weight for this batch after deletion
                const remainingWeightsForBatch = weightRecords.filter(rec => rec.batchId === batchId && rec.id !== weightRecordToDelete.id);
                const latestRemainingWeight = remainingWeightsForBatch.sort((a, b) => new Date(b.date) - new Date(a.date))[0];

                let updatedCurrentWeight = 0;
                let updatedFCR = 0;

                if (latestRemainingWeight) {
                    updatedCurrentWeight = latestRemainingWeight.averageWeight;
                    if (selectedBatch.feedConsumed > 0 && selectedBatch.currentCount > 0 && updatedCurrentWeight > 0) {
                        updatedFCR = selectedBatch.feedConsumed / (updatedCurrentWeight * selectedBatch.currentCount);
                    }
                }
                // If no remaining weights, reset to 0 or initial state
                await updateDoc(batchDocRef, {
                    currentWeight: updatedCurrentWeight,
                    feedConversionRatio: updatedFCR
                });
            }


            setIsDeleteWeightConfirmOpen(false);
            setWeightRecordToDelete(null);
            setNotificationMessage("Weight record deleted successfully!");
            setNotificationType('success');
        } catch (deleteError) {
            console.error("Error deleting weight record:", deleteError);
            setNotificationMessage(`Failed to delete weight record: ${deleteError.message}`);
            setNotificationType('error');
        }
    };

    const groupedWeightRecords = weightRecords.reduce((acc, record) => {
        const batchName = batches.find(b => b.id === record.batchId)?.name || `Unknown Batch (${record.batchId})`;
        if (!acc[batchName]) {
            acc[batchName] = [];
        }
        acc[batchName].push(record);
        return acc;
    }, {});

    return (
        <div className="p-6 bg-gray-50 rounded-lg shadow-inner">
            <div className="mb-8 p-6 bg-gray-50 rounded-lg shadow-inner">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-semibold text-gray-700">Record Weight</h2>
                    <button
                        onClick={() => setIsRecordWeightFormExpanded(!isRecordWeightFormExpanded)}
                        className="p-2 rounded-full bg-gray-200 hover:bg-gray-300 transition duration-150"
                        aria-expanded={isRecordWeightFormExpanded}
                        aria-controls="record-weight-form"
                    >
                        {isRecordWeightFormExpanded ? (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                            </svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                            </svg>
                        )}
                    </button>
                </div>

                {isRecordWeightFormExpanded && (
                    <form onSubmit={handleAddWeight} className="grid grid-cols-1 md:grid-cols-2 gap-4" id="record-weight-form">
                        <div>
                            <label htmlFor="selectBatchWeight" className="block text-sm font-medium text-gray-700 mb-1">Select Batch</label>
                            <select
                                id="selectBatchWeight"
                                value={selectedBatchId}
                                onChange={(e) => setSelectedBatchId(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            >
                                <option value="">-- Select a Batch --</option>
                                {batches.map(batch => (
                                    <option key={batch.id} value={batch.id}>{batch.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="weightDate" className="block text-sm font-medium text-gray-700 mb-1">Date of Weighing</label>
                            <input
                                type="date"
                                id="weightDate"
                                value={weightDate}
                                onChange={(e) => setWeightDate(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="averageWeight" className="block text-sm font-medium text-gray-700 mb-1">Average Weight (kg)</label>
                            <input
                                type="number"
                                id="averageWeight"
                                value={averageWeight}
                                onChange={(e) => setAverageWeight(e.target.value)}
                                placeholder="e.g., 2.5"
                                step="0.01"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                min="0.01"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="weightNotes" className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
                            <textarea
                                id="weightNotes"
                                value={weightNotes}
                                onChange={(e) => setWeightNotes(e.target.value)}
                                placeholder="e.g., Weekly weigh-in"
                                rows="2"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                            ></textarea>
                        </div>
                        <div className="md:col-span-2">
                            <button
                                type="submit"
                                className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition duration-200 ease-in-out shadow-md"
                            >
                                Record Weight
                            </button>
                        </div>
                    </form>
                )}
            </div>

            <h2 className="text-2xl font-semibold text-gray-700 mb-4">Weight History</h2>
            {weightError && <p className="text-red-600 mb-4">{weightError}</p>}
            {loadingWeights ? (
                <p className="text-gray-500 text-center py-8">Loading weight records...</p>
            ) : Object.keys(groupedWeightRecords).length === 0 ? (
                <p className="text-gray-500 text-center py-8">No weight records yet.</p>
            ) : (
                <div className="space-y-6">
                    {Object.entries(groupedWeightRecords).map(([batchName, records]) => (
                        <div key={batchName} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                            <h3 className="text-lg font-bold text-gray-800 mb-3">{batchName}</h3>
                            <ul className="divide-y divide-gray-200">
                                {records.map(record => (
                                    <li key={record.id} className="py-3 flex justify-between items-center">
                                        <div>
                                            <p className="text-sm text-gray-800">
                                                <span className="font-semibold">Date:</span> {record.date}
                                            </p>
                                            <p className="text-sm text-gray-800">
                                                <span className="font-semibold">Avg. Weight:</span> {record.averageWeight.toFixed(2)} kg
                                            </p>
                                            {record.notes && (
                                                <p className="text-xs text-gray-600">
                                                    <span className="font-semibold">Notes:</span> {record.notes}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex space-x-2">
                                            <button
                                                onClick={() => openEditWeightModal(record)}
                                                className="text-blue-600 hover:text-blue-800 text-sm px-3 py-1 rounded-md border border-blue-600 hover:border-blue-800 transition duration-150"
                                            >
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => openDeleteWeightConfirm(record)}
                                                className="text-red-600 hover:text-red-800 text-sm px-3 py-1 rounded-md border border-red-600 hover:border-red-800 transition duration-150"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            )}

            {isEditWeightModalOpen && (
                <EditWeightModal
                    record={weightRecordToEdit}
                    onClose={() => setIsEditWeightModalOpen(false)}
                    onSave={handleSaveEditedWeight}
                    batches={batches}
                />
            )}

            {isDeleteWeightConfirmOpen && (
                <DeleteWeightConfirmModal
                    record={weightRecordToDelete}
                    onClose={() => setIsDeleteWeightConfirmOpen(false)}
                    onConfirm={handleDeleteWeight}
                    batches={batches}
                />
            )}
        </div>
    );
};

// --- EditWeightModal Component ---
const EditWeightModal = ({ record, onClose, onSave, batches }) => {
    const [editedBatchId] = useState(record.batchId); // Not editable
    const [editedDate, setEditedDate] = useState(record.date);
    const [editedAverageWeight, setEditedAverageWeight] = useState(record.averageWeight);
    const [editedNotes, setEditedNotes] = useState(record.notes || '');
    const [errorMessage, setErrorMessage] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        setErrorMessage('');

        const parsedAverageWeight = parseFloat(editedAverageWeight);

        if (!editedBatchId || !editedDate || isNaN(parsedAverageWeight) || parsedAverageWeight <= 0) {
            setErrorMessage("Please fill all required fields correctly (Batch, Date, Average Weight).");
            return;
        }

        const updatedData = {
            batchId: editedBatchId,
            date: editedDate,
            averageWeight: parsedAverageWeight,
            notes: editedNotes
        };
        onSave(updatedData);
    };

    const batchName = batches.find(b => b.id === record.batchId)?.name || 'Unknown Batch';

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Edit Weight Record for {batchName}</h2>
                {errorMessage && <p className="text-red-600 mb-4">{errorMessage}</p>}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="editWeightDate" className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                        <input
                            type="date"
                            id="editWeightDate"
                            value={editedDate}
                            onChange={(e) => setEditedDate(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editAverageWeight" className="block text-sm font-medium text-gray-700 mb-1">Average Weight (kg)</label>
                        <input
                            type="number"
                            id="editAverageWeight"
                            value={editedAverageWeight}
                            onChange={(e) => setEditedAverageWeight(e.target.value)}
                            step="0.01"
                            className="w-full p-2 border border-gray-300 rounded-md"
                            min="0.01"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editWeightNotes" className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
                        <textarea
                            id="editWeightNotes"
                            value={editedNotes}
                            onChange={(e) => setEditedNotes(e.target.value)}
                            rows="2"
                            className="w-full p-2 border border-gray-300 rounded-md"
                        ></textarea>
                    </div>
                    <div className="flex justify-end space-x-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-150"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition duration-150"
                        >
                            Save Changes
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- DeleteWeightConfirmModal Component ---
const DeleteWeightConfirmModal = ({ record, onClose, onConfirm, batches }) => {
    const batchName = batches.find(b => b.id === record.batchId)?.name || record.batchId;

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm text-center">
                <h2 className="text-xl font-bold text-gray-800 mb-4">Confirm Deletion</h2>
                <p className="text-gray-700 mb-6">
                    Are you sure you want to delete the weight record for batch "<span className="font-semibold">{batchName}</span>" on {record?.date} ({record?.averageWeight} kg)?
                    This action cannot be undone.
                </p>
                <div className="flex justify-center space-x-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-150"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition duration-150"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- BroilerSalesTab Component ---
const BroilerSalesTab = ({ batches, setNotificationMessage, setNotificationType }) => {
    const { db, userId, appId } = useContext(AppContext);
    const [selectedBatchId, setSelectedBatchId] = useState('');
    const [saleDate, setSaleDate] = useState('');
    const [quantitySold, setQuantitySold] = useState('');
    const [pricePerBird, setPricePerBird] = useState('');
    const [saleType, setSaleType] = useState('Cash'); // 'Cash' or 'Credit'
    const [customerName, setCustomerName] = useState('');
    const [initialAmountReceived, setInitialAmountReceived] = useState('');
    const [saleNotes, setSaleNotes] = useState('');

    const [salesRecords, setSalesRecords] = useState([]);
    const [loadingSales, setLoadingSales] = useState(true);
    const [salesError, setSalesError] = useState(null);
    const [isRecordSaleFormExpanded, setIsRecordSaleFormExpanded] = useState(false);

    const [isEditSaleModalOpen, setIsEditSaleModalOpen] = useState(false);
    const [saleToEdit, setSaleToEdit] = useState(null);
    const [isDeleteSaleConfirmOpen, setIsDeleteSaleConfirmOpen] = useState(false);
    const [saleToDelete, setSaleToDelete] = useState(null);
    const [isRecordPaymentModalOpen, setIsRecordPaymentModalOpen] = useState(false);
    const [saleToReceivePayment, setSaleToReceivePayment] = useState(null);

    useEffect(() => {
        if (!db || !userId) return;

        setLoadingSales(true);
        setSalesError(null);

        try {
            const salesCollectionPath = `artifacts/${appId}/users/${userId}/salesRecords`;
            const salesCollectionRef = collection(db, salesCollectionPath);

            const unsubscribe = onSnapshot(salesCollectionRef, (snapshot) => {
                const fetchedRecords = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                const sortedRecords = [...fetchedRecords].sort((a, b) => {
                    const dateA = a.date ? new Date(a.date) : new Date(0);
                    const dateB = b.date ? new Date(b.date) : new Date(0);
                    return dateB.getTime() - dateA.getTime();
                });
                setSalesRecords(sortedRecords);
                setLoadingSales(false);
            }, (snapshotError) => {
                console.error("Error fetching sales records:", snapshotError);
                setSalesError(`Failed to load sales records: ${snapshotError.message}`);
                setLoadingSales(false);
            });

            return () => unsubscribe();
        } catch (fetchError) {
            console.error("Error setting up sales listener:", fetchError);
            setSalesError(`Error setting up sales listener: ${fetchError.message}`);
            setLoadingSales(false);
        }
    }, [db, userId, appId]);

    const handleAddSale = async (e) => {
        e.preventDefault();
        if (!db || !userId) {
            setNotificationMessage("Firebase not initialized or user not authenticated.");
            setNotificationType('error');
            return;
        }
        if (!selectedBatchId || !saleDate || !quantitySold || !pricePerBird) {
            setNotificationMessage("Please select a batch, date, quantity, and price per bird.");
            setNotificationType('error');
            return;
        }

        const parsedQuantitySold = parseInt(quantitySold, 10);
        const parsedPricePerBird = parseFloat(pricePerBird);
        const parsedInitialAmountReceived = parseFloat(initialAmountReceived || '0');

        if (isNaN(parsedQuantitySold) || parsedQuantitySold <= 0) {
            setNotificationMessage("Please enter a valid positive number for quantity sold.");
            setNotificationType('error');
            return;
        }
        if (isNaN(parsedPricePerBird) || parsedPricePerBird <= 0) {
            setNotificationMessage("Please enter a valid positive number for price per bird.");
            setNotificationType('error');
            return;
        }
        if (isNaN(parsedInitialAmountReceived) || parsedInitialAmountReceived < 0) {
            setNotificationMessage("Please enter a valid non-negative number for amount received.");
            setNotificationType('error');
            return;
        }

        const selectedBatch = batches.find(b => b.id === selectedBatchId);
        if (!selectedBatch) {
            setNotificationMessage("Selected batch not found.");
            setNotificationType('error');
            return;
        }

        if (parsedQuantitySold > selectedBatch.currentCount) {
            setNotificationMessage("Quantity sold cannot exceed current live bird count in the batch.");
            setNotificationType('error');
            return;
        }

        const totalRevenue = parsedQuantitySold * parsedPricePerBird;
        let finalAmountReceived = parsedInitialAmountReceived;
        let balanceDue = totalRevenue - finalAmountReceived;
        let paymentStatus = 'Unpaid';

        if (saleType === 'Cash') {
            finalAmountReceived = totalRevenue;
            balanceDue = 0;
            paymentStatus = 'Paid';
        } else { // Credit
            if (finalAmountReceived >= totalRevenue) {
                finalAmountReceived = totalRevenue;
                balanceDue = 0;
                paymentStatus = 'Paid';
            } else if (finalAmountReceived > 0) {
                paymentStatus = 'Partially Paid';
            }
        }

        if (finalAmountReceived > totalRevenue) {
            setNotificationMessage("Amount received cannot exceed total revenue.");
            setNotificationType('error');
            return;
        }

        try {
            const salesCollectionPath = `artifacts/${appId}/users/${userId}/salesRecords`;
            await addDoc(collection(db, salesCollectionPath), {
                batchId: selectedBatchId,
                date: saleDate,
                quantitySold: parsedQuantitySold,
                pricePerBird: parsedPricePerBird,
                totalRevenue: totalRevenue,
                saleType: saleType,
                customerName: customerName,
                amountReceived: finalAmountReceived,
                balanceDue: balanceDue,
                paymentStatus: paymentStatus,
                notes: saleNotes,
                createdAt: serverTimestamp()
            });

            // Update associated batch
            const batchDocRef = doc(db, `artifacts/${appId}/users/${userId}/broilerBatches`, selectedBatchId);
            const newCurrentCount = selectedBatch.currentCount - parsedQuantitySold;
            const newTotalSalesRevenue = (selectedBatch.totalSalesRevenue || 0) + totalRevenue;
            // const newEstimatedProfitLoss = (selectedBatch.estimatedProfitLoss || 0) + totalRevenue; // <--- REMOVE OR COMMENT OUT THIS LINE

            await updateDoc(batchDocRef, {
                currentCount: newCurrentCount,
                totalSalesRevenue: newTotalSalesRevenue,
                // estimatedProfitLoss: newEstimatedProfitLoss, // <--- REMOVE OR COMMENT OUT THIS LINE
                totalBirdsSold: (selectedBatch.totalBirdsSold || 0) + parsedQuantitySold // New field
            });

            setSelectedBatchId('');
            setSaleDate('');
            setQuantitySold('');
            setPricePerBird('');
            setSaleType('Cash');
            setCustomerName('');
            setInitialAmountReceived('');
            setSaleNotes('');
            setNotificationMessage("Sale recorded and batch updated successfully!");
            setNotificationType('success');
        } catch (addError) {
            console.error("Error adding sale record or updating batch:", addError);
            setNotificationMessage(`Failed to record sale: ${addError.message}`);
            setNotificationType('error');
        }
    };

    const openEditSaleModal = (record) => {
        setSaleToEdit(record);
        setIsEditSaleModalOpen(true);
    };

    const handleSaveEditedSale = async (updatedRecordData) => {
        if (!db || !userId || !saleToEdit?.id) {
            setNotificationMessage("Firebase not initialized or sale record ID missing for update.");
            setNotificationType('error');
            return;
        }

        const originalRecord = salesRecords.find(s => s.id === saleToEdit.id);
        if (!originalRecord) {
            setNotificationMessage("Original sale record not found for update.");
            setNotificationType('error');
            return;
        }

        const oldQuantitySold = originalRecord.quantitySold;
        const oldTotalRevenue = originalRecord.totalRevenue;
        const oldBatchId = originalRecord.batchId;

        const newQuantitySold = parseInt(updatedRecordData.quantitySold, 10);
        const newPricePerBird = parseFloat(updatedRecordData.pricePerBird);
        const newTotalRevenue = newQuantitySold * newPricePerBird;
        const newSaleType = updatedRecordData.saleType;
        const newAmountReceived = parseFloat(updatedRecordData.amountReceived || '0');

        if (isNaN(newQuantitySold) || newQuantitySold <= 0 || isNaN(newPricePerBird) || newPricePerBird <= 0 || isNaN(newAmountReceived) || newAmountReceived < 0) {
            setNotificationMessage("Please enter valid positive numbers for quantity, price, and non-negative for amount received.");
            setNotificationType('error');
            return;
        }

        if (newAmountReceived > newTotalRevenue) {
            setNotificationMessage("Amount received cannot exceed total revenue.");
            setNotificationType('error');
            return;
        }

        let finalBalanceDue = newTotalRevenue - newAmountReceived;
        let finalPaymentStatus = 'Unpaid';
        if (newSaleType === 'Cash') {
            finalBalanceDue = 0;
            finalPaymentStatus = 'Paid';
        } else { // Credit
            if (newAmountReceived >= newTotalRevenue) {
                finalPaymentStatus = 'Paid';
            } else if (newAmountReceived > 0) {
                finalPaymentStatus = 'Partially Paid';
            }
        }

        try {
            // Update batch counts if quantity or batch changed
            if (oldQuantitySold !== newQuantitySold || oldBatchId !== updatedRecordData.batchId) {
                // Revert old batch
                const oldBatchDocRef = doc(db, `artifacts/${appId}/users/${userId}/broilerBatches`, oldBatchId);
                const oldBatchSnap = await getDoc(oldBatchDocRef);
                if (oldBatchSnap.exists()) {
                    const oldBatchData = oldBatchSnap.data();
                    await updateDoc(oldBatchDocRef, {
                        currentCount: oldBatchData.currentCount + oldQuantitySold,
                        totalSalesRevenue: (oldBatchData.totalSalesRevenue || 0) - oldTotalRevenue,
                        // estimatedProfitLoss: (oldBatchData.estimatedProfitLoss || 0) - oldTotalRevenue, // <--- REMOVE THIS LINE
                        totalBirdsSold: (oldBatchData.totalBirdsSold || 0) - oldQuantitySold
                    });
                } else {
                    console.warn("Old batch not found during sale edit reversion:", oldBatchId);
                }

                // Apply to new batch (or same batch if only quantity changed)
                const newBatchDocRef = doc(db, `artifacts/${appId}/users/${userId}/broilerBatches`, updatedRecordData.batchId);
                const newBatchSnap = await getDoc(newBatchDocRef);
                if (newBatchSnap.exists()) {
                    const newBatchData = newBatchSnap.data();
                    // When moving from one batch to another, or changing quantity in the same batch:
                    // We need to account for the quantity that was "freed up" from the old record.
                    // If oldBatchId === updatedRecordData.batchId, the oldQuantitySold is added back *before* subtracting newQuantitySold.
                    // This ensures available count for the current batch is accurate.
                    const availableForSale = newBatchData.currentCount + (oldBatchId === updatedRecordData.batchId ? oldQuantitySold : 0);

                    if (newQuantitySold > availableForSale) {
                        setNotificationMessage(`New quantity sold (${newQuantitySold}) exceeds available birds (${availableForSale}) in the selected batch.`);
                        setNotificationType('error');
                        // OPTIONAL: Revert the old batch update if this fails, or use a transaction.
                        return; // Prevent update if quantity is too high
                    }

                    await updateDoc(newBatchDocRef, {
                        currentCount: newBatchData.currentCount - newQuantitySold + (oldBatchId === updatedRecordData.batchId ? oldQuantitySold : 0),
                        totalSalesRevenue: (newBatchData.totalSalesRevenue || 0) - (oldBatchId === updatedRecordData.batchId ? oldTotalRevenue : 0) + newTotalRevenue,
                        // estimatedProfitLoss: (newBatchData.estimatedProfitLoss || 0) + newTotalRevenue, // <--- REMOVE THIS LINE
                        totalBirdsSold: (newBatchData.totalBirdsSold || 0) - (oldBatchId === updatedRecordData.batchId ? oldQuantitySold : 0) + newQuantitySold
                    });
                } else {
                    setNotificationMessage("New batch not found. Batch update failed.");
                    setNotificationType('error');
                    // OPTIONAL: Revert the old batch update if this fails, or use a transaction.
                    return;
                }
            } else if (oldTotalRevenue !== newTotalRevenue) {
                // Only revenue changed (pricePerBird changed), batchId and quantitySold are the same.
                // Only update totalSalesRevenue for the *same* batch.
                const batchDocRef = doc(db, `artifacts/${appId}/users/${userId}/broilerBatches`, updatedRecordData.batchId);
                const batchSnap = await getDoc(batchDocRef);
                if (batchSnap.exists()) {
                    const batchData = batchSnap.data();
                    await updateDoc(batchDocRef, {
                        totalSalesRevenue: (batchData.totalSalesRevenue || 0) - oldTotalRevenue + newTotalRevenue,
                        // estimatedProfitLoss: (batchData.estimatedProfitLoss || 0) - oldTotalRevenue + newTotalRevenue, // <--- REMOVE THIS LINE
                    });
                }
            }


            // Update the sale record itself
            const saleDocRef = doc(db, `artifacts/${appId}/users/${userId}/salesRecords`, saleToEdit.id);
            await updateDoc(saleDocRef, {
                batchId: updatedRecordData.batchId,
                date: updatedRecordData.date,
                quantitySold: newQuantitySold,
                pricePerBird: newPricePerBird,
                totalRevenue: newTotalRevenue,
                saleType: newSaleType,
                customerName: updatedRecordData.customerName,
                amountReceived: newAmountReceived,
                balanceDue: finalBalanceDue,
                paymentStatus: finalPaymentStatus,
                notes: updatedRecordData.notes,
                updatedAt: serverTimestamp()
            });

            setIsEditSaleModalOpen(false);
            setSaleToEdit(null);
            setNotificationMessage("Sale record updated successfully!");
            setNotificationType('success');
        } catch (updateError) {
            console.error("Error updating sale record:", updateError);
            setNotificationMessage(`Failed to update sale record: ${updateError.message}`);
            setNotificationType('error');
        }
    };

    const openDeleteSaleConfirm = (record) => {
        setSaleToDelete(record);
        setIsDeleteSaleConfirmOpen(true);
    };

    const handleDeleteSale = async () => {
        if (!db || !userId || !saleToDelete?.id) {
            setNotificationMessage("Firebase not initialized or sale record ID missing for deletion.");
            setNotificationType('error');
            return;
        }

        const deletedQuantity = saleToDelete.quantitySold;
        const deletedTotalRevenue = saleToDelete.totalRevenue;
        const batchId = saleToDelete.batchId;

        try {
            // Revert batch counts
            const batchDocRef = doc(db, `artifacts/${appId}/users/${userId}/broilerBatches`, batchId);
            const batchSnap = await getDoc(batchDocRef);
            if (batchSnap.exists()) {
                const batchData = batchSnap.data();
                await updateDoc(batchDocRef, {
                    currentCount: batchData.currentCount + deletedQuantity,
                    totalSalesRevenue: Math.max(0, (batchData.totalSalesRevenue || 0) - deletedTotalRevenue),
                    // estimatedProfitLoss: (batchData.estimatedProfitLoss || 0) - deletedTotalRevenue, // <--- REMOVE OR COMMENT OUT THIS LINE
                    totalBirdsSold: Math.max(0, (batchData.totalBirdsSold || 0) - deletedQuantity)
                });
            } else {
                console.warn("Batch not found for sale record deletion reversion:", batchId);
            }

            const saleDocRef = doc(db, `artifacts/${appId}/users/${userId}/salesRecords`, saleToDelete.id);
            await deleteDoc(saleDocRef);

            setIsDeleteSaleConfirmOpen(false);
            setSaleToDelete(null);
            setNotificationMessage("Sale record deleted successfully!");
            setNotificationType('success');
        } catch (deleteError) {
            console.error("Error deleting sale record:", deleteError);
            setNotificationMessage(`Failed to delete sale record: ${deleteError.message}`);
            setNotificationType('error');
        }
    };

    const openRecordPaymentModal = (record) => {
        setSaleToReceivePayment(record);
        setIsRecordPaymentModalOpen(true);
    };

    const handleRecordPayment = async (saleId, amount) => {
        if (!db || !userId || !saleId) {
            setNotificationMessage("Firebase not initialized or sale ID missing for payment.");
            setNotificationType('error');
            return;
        }

        const saleRecord = salesRecords.find(s => s.id === saleId);
        if (!saleRecord) {
            setNotificationMessage("Sale record not found for payment.");
            setNotificationType('error');
            return;
        }

        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            setNotificationMessage("Please enter a valid positive amount for payment.");
            setNotificationType('error');
            return;
        }

        const newAmountReceived = saleRecord.amountReceived + parsedAmount;
        let newBalanceDue = saleRecord.totalRevenue - newAmountReceived;
        let newPaymentStatus = saleRecord.paymentStatus;

        if (newAmountReceived >= saleRecord.totalRevenue) {
            newAmountReceived = saleRecord.totalRevenue; // Cap at total revenue
            newBalanceDue = 0;
            newPaymentStatus = 'Paid';
        } else {
            newPaymentStatus = 'Partially Paid';
        }

        try {
            const saleDocRef = doc(db, `artifacts/${appId}/users/${userId}/salesRecords`, saleId);
            await updateDoc(saleDocRef, {
                amountReceived: newAmountReceived,
                balanceDue: newBalanceDue,
                paymentStatus: newPaymentStatus,
                updatedAt: serverTimestamp()
            });

            setIsRecordPaymentModalOpen(false);
            setSaleToReceivePayment(null);
            setNotificationMessage("Payment recorded successfully!");
            setNotificationType('success');
        } catch (paymentError) {
            console.error("Error recording payment:", paymentError);
            setNotificationMessage(`Failed to record payment: ${paymentError.message}`);
            setNotificationType('error');
        }
    };

    const groupedSalesRecords = salesRecords.reduce((acc, record) => {
        const batchName = batches.find(b => b.id === record.batchId)?.name || `Unknown Batch (${record.batchId})`;
        if (!acc[batchName]) {
            acc[batchName] = [];
        }
        acc[batchName].push(record);
        return acc;
    }, {});

    const totalSalesRevenue = salesRecords.reduce((sum, record) => sum + record.totalRevenue, 0);
    const totalAmountReceived = salesRecords.reduce((sum, record) => sum + record.amountReceived, 0);
    const totalBalanceDue = salesRecords.reduce((sum, record) => sum + record.balanceDue, 0);

    return (
        <div className="p-6 bg-gray-50 rounded-lg shadow-inner">
            <div className="mb-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
                <h3 className="text-xl font-semibold text-gray-700 mb-2">Overall Sales Summary</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <p className="text-lg text-gray-800">
                        <span className="font-semibold">Total Revenue:</span> ${totalSalesRevenue.toFixed(2)}
                    </p>
                    <p className="text-lg text-gray-800">
                        <span className="font-semibold">Total Received:</span> ${totalAmountReceived.toFixed(2)}
                    </p>
                    <p className="text-lg text-gray-800">
                        <span className="font-semibold">Total Balance Due:</span> ${totalBalanceDue.toFixed(2)}
                    </p>
                </div>
            </div>

            <div className="mb-8 p-6 bg-gray-50 rounded-lg shadow-inner">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-semibold text-gray-700">Record New Broiler Sale</h2>
                    <button
                        onClick={() => setIsRecordSaleFormExpanded(!isRecordSaleFormExpanded)}
                        className="p-2 rounded-full bg-gray-200 hover:bg-gray-300 transition duration-150"
                        aria-expanded={isRecordSaleFormExpanded}
                        aria-controls="record-sale-form"
                    >
                        {isRecordSaleFormExpanded ? (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                            </svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                            </svg>
                        )}
                    </button>
                </div>

                {isRecordSaleFormExpanded && (
                    <form onSubmit={handleAddSale} className="grid grid-cols-1 md:grid-cols-2 gap-4" id="record-sale-form">
                        <div>
                            <label htmlFor="selectBatchSale" className="block text-sm font-medium text-gray-700 mb-1">Select Batch</label>
                            <select
                                id="selectBatchSale"
                                value={selectedBatchId}
                                onChange={(e) => setSelectedBatchId(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            >
                                <option value="">-- Select a Batch --</option>
                                {batches.map(batch => (
                                    <option key={batch.id} value={batch.id}>{batch.name} (Current: {batch.currentCount} birds)</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="saleDate" className="block text-sm font-medium text-gray-700 mb-1">Date of Sale</label>
                            <input
                                type="date"
                                id="saleDate"
                                value={saleDate}
                                onChange={(e) => setSaleDate(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="quantitySold" className="block text-sm font-medium text-gray-700 mb-1">Quantity Sold</label>
                            <input
                                type="number"
                                id="quantitySold"
                                value={quantitySold}
                                onChange={(e) => setQuantitySold(e.target.value)}
                                placeholder="e.g., 10"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                min="1"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="pricePerBird" className="block text-sm font-medium text-gray-700 mb-1">Price Per Bird ($)</label>
                            <input
                                type="number"
                                id="pricePerBird"
                                value={pricePerBird}
                                onChange={(e) => setPricePerBird(e.target.value)}
                                placeholder="e.g., 5.00"
                                step="0.01"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                min="0.01"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="saleType" className="block text-sm font-medium text-gray-700 mb-1">Sale Type</label>
                            <select
                                id="saleType"
                                value={saleType}
                                onChange={(e) => {
                                    setSaleType(e.target.value);
                                    if (e.target.value === 'Cash') {
                                        setInitialAmountReceived(''); // Clear for cash, will be auto-filled
                                    }
                                }}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            >
                                <option value="Cash">Cash Sale</option>
                                <option value="Credit">Credit Sale</option>
                            </select>
                        </div>
                        {saleType === 'Credit' && (
                            <div>
                                <label htmlFor="initialAmountReceived" className="block text-sm font-medium text-gray-700 mb-1">Initial Amount Received ($)</label>
                                <input
                                    type="number"
                                    id="initialAmountReceived"
                                    value={initialAmountReceived}
                                    onChange={(e) => setInitialAmountReceived(e.target.value)}
                                    placeholder="e.g., 20.00 (partial payment)"
                                    step="0.01"
                                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                    min="0"
                                />
                            </div>
                        )}
                        <div>
                            <label htmlFor="customerName" className="block text-sm font-medium text-gray-700 mb-1">Customer Name (Optional)</label>
                            <input
                                type="text"
                                id="customerName"
                                value={customerName}
                                onChange={(e) => setCustomerName(e.target.value)}
                                placeholder="e.g., Local Butcher"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                            />
                        </div>
                        <div>
                            <label htmlFor="saleNotes" className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
                            <textarea
                                id="saleNotes"
                                value={saleNotes}
                                onChange={(e) => setSaleNotes(e.target.value)}
                                placeholder="e.g., Sold to new client"
                                rows="2"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                            ></textarea>
                        </div>
                        <div className="md:col-span-2">
                            <button
                                type="submit"
                                className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition duration-200 ease-in-out shadow-md"
                            >
                                Record Sale
                            </button>
                        </div>
                    </form>
                )}
            </div>

            <h2 className="text-2xl font-semibold text-gray-700 mb-4">Sales History</h2>
            {salesError && <p className="text-red-600 mb-4">{salesError}</p>}
            {loadingSales ? (
                <p className="text-gray-500 text-center py-8">Loading sales records...</p>
            ) : Object.keys(groupedSalesRecords).length === 0 ? (
                <p className="text-gray-500 text-center py-8">No sales records yet.</p>
            ) : (
                <div className="space-y-6">
                    {Object.entries(groupedSalesRecords).map(([batchName, records]) => (
                        <div key={batchName} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                            <h3 className="text-lg font-bold text-gray-800 mb-3">{batchName}</h3>
                            <ul className="divide-y divide-gray-200">
                                {records.map(record => (
                                    <li key={record.id} className="py-3 flex justify-between items-center flex-wrap gap-2">
                                        <div>
                                            <p className="text-sm text-gray-800">
                                                <span className="font-semibold">Date:</span> {record.date}
                                            </p>
                                            <p className="text-sm text-gray-800">
                                                <span className="font-semibold">Qty:</span> {record.quantitySold} birds @ ${record.pricePerBird.toFixed(2)}/bird
                                            </p>
                                            <p className="text-sm text-gray-800">
                                                <span className="font-semibold">Revenue:</span> ${record.totalRevenue.toFixed(2)} ({record.saleType})
                                            </p>
                                            {record.saleType === 'Credit' && (
                                                <>
                                                    <p className="text-sm text-gray-800">
                                                        <span className="font-semibold">Received:</span> ${record.amountReceived.toFixed(2)}
                                                    </p>
                                                    <p className="text-sm text-gray-800">
                                                        <span className="font-semibold">Balance Due:</span> ${record.balanceDue.toFixed(2)}
                                                    </p>
                                                    <p className="text-sm text-gray-800">
                                                        <span className="font-semibold">Status:</span>
                                                        <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                                                            record.paymentStatus === 'Paid' ? 'bg-green-100 text-green-800' :
                                                            record.paymentStatus === 'Partially Paid' ? 'bg-yellow-100 text-yellow-800' :
                                                            'bg-red-100 text-red-800'
                                                        }`}>
                                                            {record.paymentStatus}
                                                        </span>
                                                    </p>
                                                </>
                                            )}
                                            {record.customerName && (
                                                <p className="text-xs text-gray-600">
                                                    <span className="font-semibold">Customer:</span> {record.customerName}
                                                </p>
                                            )}
                                            {record.notes && (
                                                <p className="text-xs text-gray-600">
                                                    <span className="font-semibold">Notes:</span> {record.notes}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex space-x-2 mt-2 sm:mt-0">
                                            {record.saleType === 'Credit' && record.paymentStatus !== 'Paid' && (
                                                <button
                                                    onClick={() => openRecordPaymentModal(record)}
                                                    className="text-green-600 hover:text-green-800 text-sm px-3 py-1 rounded-md border border-green-600 hover:border-green-800 transition duration-150"
                                                >
                                                    Record Payment
                                                </button>
                                            )}
                                            <button
                                                onClick={() => openEditSaleModal(record)}
                                                className="text-blue-600 hover:text-blue-800 text-sm px-3 py-1 rounded-md border border-blue-600 hover:border-blue-800 transition duration-150"
                                            >
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => openDeleteSaleConfirm(record)}
                                                className="text-red-600 hover:text-red-800 text-sm px-3 py-1 rounded-md border border-red-600 hover:border-red-800 transition duration-150"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            )}

            {isEditSaleModalOpen && (
                <EditSaleModal
                    sale={saleToEdit}
                    onClose={() => setIsEditSaleModalOpen(false)}
                    onSave={handleSaveEditedSale}
                    batches={batches}
                />
            )}

            {isDeleteSaleConfirmOpen && (
                <DeleteSaleConfirmModal
                    sale={saleToDelete}
                    onClose={() => setIsDeleteSaleConfirmOpen(false)}
                    onConfirm={handleDeleteSale}
                    batches={batches}
                />
            )}

            {isRecordPaymentModalOpen && (
                <RecordPaymentModal
                    sale={saleToReceivePayment}
                    onClose={() => setIsRecordPaymentModalOpen(false)}
                    onRecordPayment={handleRecordPayment}
                />
            )}
        </div>
    );
};

// --- EditSaleModal Component ---
const EditSaleModal = ({ sale, onClose, onSave, batches }) => {
    const [editedBatchId, setEditedBatchId] = useState(sale.batchId);
    const [editedDate, setEditedDate] = useState(sale.date);
    const [editedQuantitySold, setEditedQuantitySold] = useState(sale.quantitySold);
    const [editedPricePerBird, setEditedPricePerBird] = useState(sale.pricePerBird);
    const [editedSaleType, setEditedSaleType] = useState(sale.saleType);
    const [editedCustomerName, setEditedCustomerName] = useState(sale.customerName || '');
    const [editedAmountReceived, setEditedAmountReceived] = useState(sale.amountReceived);
    const [editedNotes, setEditedNotes] = useState(sale.notes || '');
    const [errorMessage, setErrorMessage] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        setErrorMessage('');

        const parsedQuantitySold = parseInt(editedQuantitySold, 10);
        const parsedPricePerBird = parseFloat(editedPricePerBird);
        const parsedAmountReceived = parseFloat(editedAmountReceived);

        if (!editedBatchId || !editedDate || isNaN(parsedQuantitySold) || parsedQuantitySold <= 0 || isNaN(parsedPricePerBird) || parsedPricePerBird <= 0) {
            setErrorMessage("Please fill all required fields correctly (Batch, Date, Quantity, Price).");
            return;
        }

        if (editedSaleType === 'Cash' && parsedAmountReceived !== (parsedQuantitySold * parsedPricePerBird)) {
             // For cash sales, amount received should match total revenue
             // This check might be too strict if user is editing a cash sale to make it credit
             // Better to let the logic in handleSaveEditedSale determine final amountReceived/balanceDue
        }

        const updatedData = {
            batchId: editedBatchId,
            date: editedDate,
            quantitySold: parsedQuantitySold,
            pricePerBird: parsedPricePerBird,
            saleType: editedSaleType,
            customerName: editedCustomerName,
            amountReceived: parsedAmountReceived,
            notes: editedNotes
        };
        onSave(updatedData);
    };

    const batchName = batches.find(b => b.id === sale.batchId)?.name || 'Unknown Batch';

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md flex flex-col max-h-[90vh]"> {/* Added flex-col and max-h-[90vh] */}
                <h2 className="text-2xl font-bold text-gray-800 mb-4 flex-shrink-0">Edit Sale for {batchName}</h2>
                {errorMessage && <p className="text-red-600 mb-4 flex-shrink-0">{errorMessage}</p>}
                <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto pr-2 flex-grow"> {/* Added overflow-y-auto and flex-grow */}
                    <div>
                        <label htmlFor="editSaleBatch" className="block text-sm font-medium text-gray-700 mb-1">Batch</label>
                        <select
                            id="editSaleBatch"
                            value={editedBatchId}
                            onChange={(e) => setEditedBatchId(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                        >
                            {batches.map(batch => (
                                <option key={batch.id} value={batch.id}>{batch.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="editSaleDate" className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                        <input
                            type="date"
                            id="editSaleDate"
                            value={editedDate}
                            onChange={(e) => setEditedDate(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editQuantitySold" className="block text-sm font-medium text-gray-700 mb-1">Quantity Sold</label>
                        <input
                            type="number"
                            id="editQuantitySold"
                            value={editedQuantitySold}
                            onChange={(e) => setEditedQuantitySold(e.target.value)}
                            step="1"
                            className="w-full p-2 border border-gray-300 rounded-md"
                            min="1"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editPricePerBird" className="block text-sm font-medium text-gray-700 mb-1">Price Per Bird ($)</label>
                        <input
                            type="number"
                            id="editPricePerBird"
                            value={editedPricePerBird}
                            onChange={(e) => setEditedPricePerBird(e.target.value)}
                            step="0.01"
                            className="w-full p-2 border border-gray-300 rounded-md"
                            min="0.01"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editSaleType" className="block text-sm font-medium text-gray-700 mb-1">Sale Type</label>
                        <select
                            id="editSaleType"
                            value={editedSaleType}
                            onChange={(e) => setEditedSaleType(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                        >
                            <option value="Cash">Cash Sale</option>
                            <option value="Credit">Credit Sale</option>
                        </select>
                    </div>
                    {editedSaleType === 'Credit' && (
                        <div>
                            <label htmlFor="editAmountReceived" className="block text-sm font-medium text-gray-700 mb-1">Amount Received ($)</label>
                            <input
                                type="number"
                                id="editAmountReceived"
                                value={editedAmountReceived}
                                onChange={(e) => setEditedAmountReceived(e.target.value)}
                                placeholder="e.g., 20.00"
                                step="0.01"
                                className="w-full p-2 border border-gray-300 rounded-md"
                                min="0"
                            />
                        </div>
                    )}
                    <div>
                        <label htmlFor="editCustomerName" className="block text-sm font-medium text-gray-700 mb-1">Customer Name (Optional)</label>
                        <input
                            type="text"
                            id="editCustomerName"
                            value={editedCustomerName}
                            onChange={(e) => setEditedCustomerName(e.target.value)}
                            placeholder="e.g., Local Butcher"
                            className="w-full p-2 border border-gray-300 rounded-md"
                        />
                    </div>
                    <div>
                        <label htmlFor="editSaleNotes" className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
                        <textarea
                            id="editSaleNotes"
                            value={editedNotes}
                            onChange={(e) => setEditedNotes(e.target.value)}
                            rows="2"
                            className="w-full p-2 border border-gray-300 rounded-md"
                        ></textarea>
                    </div>
                </form>
                <div className="flex justify-end space-x-3 mt-6 flex-shrink-0"> {/* Added flex-shrink-0 */}
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-150"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        onClick={handleSubmit} // Call handleSubmit here for form submission
                        className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition duration-150"
                    >
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
};


// --- DeleteSaleConfirmModal Component ---
const DeleteSaleConfirmModal = ({ sale, onClose, onConfirm, batches }) => {
    const batchName = batches.find(b => b.id === sale.batchId)?.name || sale.batchId;

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm text-center">
                <h2 className="text-xl font-bold text-gray-800 mb-4">Confirm Deletion</h2>
                <p className="text-gray-700 mb-6">
                    Are you sure you want to delete the sale of <span className="font-semibold">{sale?.quantitySold}</span> birds from batch "<span className="font-semibold">{batchName}</span>" on {sale?.date} for ${sale?.totalRevenue?.toFixed(2)}?
                    This action cannot be undone.
                </p>
                <div className="flex justify-center space-x-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-150"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition duration-150"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
};

// --- RecordPaymentModal Component ---
const RecordPaymentModal = ({ sale, onClose, onRecordPayment }) => {
    const [paymentAmount, setPaymentAmount] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        setErrorMessage('');

        const amount = parseFloat(paymentAmount);
        if (isNaN(amount) || amount <= 0) {
            setErrorMessage("Please enter a valid positive amount.");
            return;
        }
        if (amount > sale.balanceDue) {
            setErrorMessage(`Payment amount cannot exceed the remaining balance due ($${sale.balanceDue.toFixed(2)}).`);
            return;
        }

        onRecordPayment(sale.id, amount);
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Record Payment for Sale</h2>
                <p className="text-gray-700 mb-2">
                    Sale Date: <span className="font-semibold">{sale.date}</span>
                </p>
                <p className="text-gray-700 mb-2">
                    Total Revenue: <span className="font-semibold">${sale.totalRevenue.toFixed(2)}</span>
                </p>
                <p className="text-gray-700 mb-4">
                    Remaining Balance: <span className="font-bold text-red-600">${sale.balanceDue.toFixed(2)}</span>
                </p>
                {errorMessage && <p className="text-red-600 mb-4">{errorMessage}</p>}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="paymentAmount" className="block text-sm font-medium text-gray-700 mb-1">Amount to Record ($)</label>
                        <input
                            type="number"
                            id="paymentAmount"
                            value={paymentAmount}
                            onChange={(e) => setPaymentAmount(e.target.value)}
                            placeholder={`Max: ${sale.balanceDue.toFixed(2)}`}
                            step="0.01"
                            className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                            min="0.01"
                            max={sale.balanceDue.toFixed(2)} // Set max to remaining balance
                            required
                        />
                    </div>
                    <div className="flex justify-end space-x-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-150"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition duration-150"
                        >
                            Record Payment
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- HealthManagementTab Component ---
const HealthManagementTab = ({ batches, setNotificationMessage, setNotificationType }) => {
    const { db, userId, appId } = useContext(AppContext);
    const [selectedBatchId, setSelectedBatchId] = useState('');
    const [healthDate, setHealthDate] = useState('');
    const [eventType, setEventType] = useState('');
    const [description, setDescription] = useState('');
    const [medicationUsed, setMedicationUsed] = useState('');
    const [dosage, setDosage] = useState('');
    const [quantityUsed, setQuantityUsed] = useState(''); // for inventory deduction
    const [unit, setUnit] = useState(''); // unit for quantityUsed
    const [affectedBirdsCount, setAffectedBirdsCount] = useState('');
    const [outcome, setOutcome] = useState('');
    const [healthNotes, setHealthNotes] = useState('');

    const [healthRecords, setHealthRecords] = useState([]);
    const [loadingHealth, setLoadingHealth] = useState(true);
    const [healthError, setHealthError] = useState(null);
    const [isRecordHealthFormExpanded, setIsRecordHealthFormExpanded] = useState(false);

    const [medicationInventory, setMedicationInventory] = useState([]);
    const [loadingMedicationInventory, setLoadingMedicationInventory] = useState(true);
    const [medicationInventoryError, setMedicationInventoryError] = useState(null);

    const [isEditHealthModalOpen, setIsEditHealthModalOpen] = useState(false);
    const [healthRecordToEdit, setHealthRecordToEdit] = useState(null);
    const [isDeleteHealthConfirmOpen, setIsDeleteHealthConfirmOpen] = useState(false);
    const [healthRecordToDelete, setHealthRecordToDelete] = useState(null);

    const eventTypes = ['Vaccination', 'Medication', 'Disease Outbreak', 'Treatment', 'Other'];
    const outcomes = ['Resolved', 'Ongoing', 'Improved', 'No Change', 'Worsened', 'Mortality'];

    useEffect(() => {
        if (!db || !userId) return;

        setLoadingHealth(true);
        setHealthError(null);

        try {
            const healthCollectionPath = `artifacts/${appId}/users/${userId}/healthRecords`;
            const healthCollectionRef = collection(db, healthCollectionPath);

            const unsubscribe = onSnapshot(healthCollectionRef, (snapshot) => {
                const fetchedRecords = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                const sortedRecords = [...fetchedRecords].sort((a, b) => {
                    const dateA = a.date ? new Date(a.date) : new Date(0);
                    const dateB = b.date ? new Date(b.date) : new Date(0);
                    return dateB.getTime() - dateA.getTime();
                });
                setHealthRecords(sortedRecords);
                setLoadingHealth(false);
            }, (snapshotError) => {
                console.error("Error fetching health records:", snapshotError);
                setHealthError(`Failed to load health records: ${snapshotError.message}`);
                setLoadingHealth(false);
            });

            return () => unsubscribe();
        } catch (fetchError) {
            console.error("Error setting up health listener:", fetchError);
            setHealthError(`Error setting up health listener: ${fetchError.message}`);
            setLoadingHealth(false);
        }
    }, [db, userId, appId]);

    useEffect(() => {
        if (!db || !userId) return;

        setLoadingMedicationInventory(true);
        setMedicationInventoryError(null);

        try {
            const inventoryCollectionPath = `artifacts/${appId}/users/${userId}/supplyInventory`;
            const inventoryCollectionRef = collection(db, inventoryCollectionPath);
            const q = query(inventoryCollectionRef, where('category', '==', 'Medication'));

            const unsubscribe = onSnapshot(q, (snapshot) => {
                const fetchedInventory = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                setMedicationInventory(fetchedInventory);
                setLoadingMedicationInventory(false);
            }, (snapshotError) => {
                console.error("Error fetching medication inventory:", snapshotError);
                setMedicationInventoryError(`Failed to load medication inventory: ${snapshotError.message}`);
                setLoadingMedicationInventory(false);
            });

            return () => unsubscribe();
        } catch (fetchError) {
            console.error("Error setting up medication inventory listener:", fetchError);
            setMedicationInventoryError(`Error setting up medication inventory listener: ${fetchError.message}`);
            setLoadingMedicationInventory(false);
        }
    }, [db, userId, appId]);

    const handleAddHealthRecord = async (e) => {
        e.preventDefault();
        if (!db || !userId) {
            setNotificationMessage("Firebase not initialized or user not authenticated.");
            setNotificationType('error');
            return;
        }
        if (!healthDate || !eventType || !description) {
            setNotificationMessage("Please fill in Date, Event Type, and Description.");
            setNotificationType('error');
            return;
        }

        const parsedQuantityUsed = parseFloat(quantityUsed);
        const parsedAffectedBirdsCount = parseInt(affectedBirdsCount, 10);

        if (quantityUsed && (isNaN(parsedQuantityUsed) || parsedQuantityUsed <= 0)) {
            setNotificationMessage("Please enter a valid positive number for Quantity Used.");
            setNotificationType('error');
            return;
        }
        if (affectedBirdsCount && (isNaN(parsedAffectedBirdsCount) || parsedAffectedBirdsCount <= 0)) {
            setNotificationMessage("Please enter a valid positive number for Affected Birds Count.");
            setNotificationType('error');
            return;
        }

        let healthData = {
            batchId: selectedBatchId || null,
            date: healthDate,
            eventType: eventType,
            description: description,
            medicationUsed: medicationUsed || null,
            dosage: dosage || null,
            quantityUsed: quantityUsed ? parsedQuantityUsed : null,
            unit: unit || null,
            affectedBirdsCount: affectedBirdsCount ? parsedAffectedBirdsCount : null,
            outcome: outcome || null,
            notes: healthNotes,
            createdAt: serverTimestamp()
        };

        try {
            // Deduct from inventory if medication and quantity are provided
            if (medicationUsed && quantityUsed) {
                const medicationItem = medicationInventory.find(item => item.name === medicationUsed);
                if (!medicationItem) {
                    setNotificationMessage(`Medication "${medicationUsed}" not found in inventory. Please add it via the Supply Inventory tab.`);
                    setNotificationType('error');
                    return;
                }
                if (medicationItem.currentStock < parsedQuantityUsed) {
                    setNotificationMessage(`Not enough "${medicationUsed}" in inventory. Current stock: ${medicationItem.currentStock.toFixed(2)} ${medicationItem.unit}. Please restock via Expense Tracking.`);
                    setNotificationType('error');
                    return;
                }

                const inventoryDocRef = doc(db, `artifacts/${appId}/users/${userId}/supplyInventory`, medicationItem.id);
                await updateDoc(inventoryDocRef, {
                    currentStock: medicationItem.currentStock - parsedQuantityUsed,
                    updatedAt: serverTimestamp()
                });
            }

            const healthCollectionPath = `artifacts/${appId}/users/${userId}/healthRecords`;
            await addDoc(collection(db, healthCollectionPath), healthData);

            setSelectedBatchId('');
            setHealthDate('');
            setEventType('');
            setDescription('');
            setMedicationUsed('');
            setDosage('');
            setQuantityUsed('');
            setUnit('');
            setAffectedBirdsCount('');
            setOutcome('');
            setHealthNotes('');
            setNotificationMessage("Health record added successfully!");
            setNotificationType('success');
        } catch (addError) {
            console.error("Error adding health record or updating inventory:", addError);
            setNotificationMessage(`Failed to add health record: ${addError.message}`);
            setNotificationType('error');
        }
    };

    const openEditHealthModal = (record) => {
        setHealthRecordToEdit(record);
        setIsEditHealthModalOpen(true);
    };

    const handleSaveEditedHealth = async (updatedRecordData) => {
        if (!db || !userId || !healthRecordToEdit?.id) {
            setNotificationMessage("Firebase not initialized or health record ID missing for update.");
            setNotificationType('error');
            return;
        }

        const originalRecord = healthRecordToEdit;
        const newQuantityUsed = parseFloat(updatedRecordData.quantityUsed);
        const newMedicationUsed = updatedRecordData.medicationUsed;

        try {
            // Revert original inventory deduction
            if (originalRecord.medicationUsed && originalRecord.quantityUsed) {
                const originalMedicationItem = medicationInventory.find(item => item.name === originalRecord.medicationUsed);
                if (originalMedicationItem) {
                    const originalInventoryDocRef = doc(db, `artifacts/${appId}/users/${userId}/supplyInventory`, originalMedicationItem.id);
                    await updateDoc(originalInventoryDocRef, {
                        currentStock: originalMedicationItem.currentStock + originalRecord.quantityUsed,
                        updatedAt: serverTimestamp()
                    });
                } else {
                    console.warn("Original medication item not found for inventory reversion:", originalRecord.medicationUsed);
                }
            }

            // Apply new inventory deduction
            if (newMedicationUsed && newQuantityUsed) {
                const newMedicationItem = medicationInventory.find(item => item.name === newMedicationUsed);
                if (newMedicationItem) {
                    if (newMedicationItem.currentStock < newQuantityUsed) {
                        setNotificationMessage(`Not enough "${newMedicationUsed}" in inventory. Current stock: ${newMedicationItem.currentStock.toFixed(2)} ${newMedicationItem.unit}. Update cancelled.`);
                        setNotificationType('error');
                        return;
                    }
                    const newInventoryDocRef = doc(db, `artifacts/${appId}/users/${userId}/supplyInventory`, newMedicationItem.id);
                    await updateDoc(newInventoryDocRef, {
                        currentStock: newMedicationItem.currentStock - newQuantityUsed,
                        updatedAt: serverTimestamp()
                    });
                } else {
                    setNotificationMessage(`New medication "${newMedicationUsed}" not found in inventory. Stock not updated.`);
                    setNotificationType('error');
                }
            }

            const healthDocRef = doc(db, `artifacts/${appId}/users/${userId}/healthRecords`, healthRecordToEdit.id);
            await updateDoc(healthDocRef, {
                batchId: updatedRecordData.batchId || null,
                date: updatedRecordData.date,
                eventType: updatedRecordData.eventType,
                description: updatedRecordData.description,
                medicationUsed: updatedRecordData.medicationUsed || null,
                dosage: updatedRecordData.dosage || null,
                quantityUsed: updatedRecordData.quantityUsed ? parseFloat(updatedRecordData.quantityUsed) : null,
                unit: updatedRecordData.unit || null,
                affectedBirdsCount: updatedRecordData.affectedBirdsCount ? parseInt(updatedRecordData.affectedBirdsCount, 10) : null,
                outcome: updatedRecordData.outcome || null,
                notes: updatedRecordData.notes,
                updatedAt: serverTimestamp()
            });

            setIsEditHealthModalOpen(false);
            setHealthRecordToEdit(null);
            setNotificationMessage("Health record updated successfully!");
            setNotificationType('success');
        } catch (updateError) {
            console.error("Error updating health record:", updateError);
            setNotificationMessage(`Failed to update health record: ${updateError.message}`);
            setNotificationType('error');
        }
    };

    const openDeleteHealthConfirm = (record) => {
        setHealthRecordToDelete(record);
        setIsDeleteHealthConfirmOpen(true);
    };

    const handleDeleteHealth = async () => {
        if (!db || !userId || !healthRecordToDelete?.id) {
            setNotificationMessage("Firebase not initialized or health record ID missing for deletion.");
            setNotificationType('error');
            return;
        }

        try {
            // Revert inventory deduction if applicable
            if (healthRecordToDelete.medicationUsed && healthRecordToDelete.quantityUsed) {
                const medicationItem = medicationInventory.find(item => item.name === healthRecordToDelete.medicationUsed);
                if (medicationItem) {
                    const inventoryDocRef = doc(db, `artifacts/${appId}/users/${userId}/supplyInventory`, medicationItem.id);
                    await updateDoc(inventoryDocRef, {
                        currentStock: medicationItem.currentStock + healthRecordToDelete.quantityUsed,
                        updatedAt: serverTimestamp()
                    });
                } else {
                    console.warn("Medication item not found for deletion reversion:", healthRecordToDelete.medicationUsed);
                }
            }

            const healthDocRef = doc(db, `artifacts/${appId}/users/${userId}/healthRecords`, healthRecordToDelete.id);
            await deleteDoc(healthDocRef);

            setIsDeleteHealthConfirmOpen(false);
            setHealthRecordToDelete(null);
            setNotificationMessage("Health record deleted successfully!");
            setNotificationType('success');
        } catch (deleteError) {
            console.error("Error deleting health record:", deleteError);
            setNotificationMessage(`Failed to delete health record: ${deleteError.message}`);
            setNotificationType('error');
        }
    };

    const groupedHealthRecords = healthRecords.reduce((acc, record) => {
        const batchName = record.batchId ? (batches.find(b => b.id === record.batchId)?.name || `Unknown Batch (${record.batchId})`) : 'General Farm Health';
        if (!acc[batchName]) {
            acc[batchName] = [];
        }
        acc[batchName].push(record);
        return acc;
    }, {});

    const handleMedicationChange = (e) => {
        const selectedMedicationName = e.target.value;
        setMedicationUsed(selectedMedicationName);
        const selectedMedication = medicationInventory.find(item => item.name === selectedMedicationName);
        if (selectedMedication) {
            setUnit(selectedMedication.unit);
        } else {
            setUnit('');
        }
    };

    return (
        <div className="p-6 bg-gray-50 rounded-lg shadow-inner">
            <div className="mb-8 p-6 bg-gray-50 rounded-lg shadow-inner">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-semibold text-gray-700">Record Health Event</h2>
                    <button
                        onClick={() => setIsRecordHealthFormExpanded(!isRecordHealthFormExpanded)}
                        className="p-2 rounded-full bg-gray-200 hover:bg-gray-300 transition duration-150"
                        aria-expanded={isRecordHealthFormExpanded}
                        aria-controls="record-health-form"
                    >
                        {isRecordHealthFormExpanded ? (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                            </svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                            </svg>
                        )}
                    </button>
                </div>

                {isRecordHealthFormExpanded && (
                    <form onSubmit={handleAddHealthRecord} className="grid grid-cols-1 md:grid-cols-2 gap-4" id="record-health-form">
                        <div>
                            <label htmlFor="healthDate" className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                            <input
                                type="date"
                                id="healthDate"
                                value={healthDate}
                                onChange={(e) => setHealthDate(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="eventType" className="block text-sm font-medium text-gray-700 mb-1">Event Type</label>
                            <select
                                id="eventType"
                                value={eventType}
                                onChange={(e) => setEventType(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            >
                                <option value="">-- Select Event Type --</option>
                                {eventTypes.map(type => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="selectedBatchHealth" className="block text-sm font-medium text-gray-700 mb-1">Select Batch (Optional)</label>
                            <select
                                id="selectedBatchHealth"
                                value={selectedBatchId}
                                onChange={(e) => setSelectedBatchId(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                            >
                                <option value="">-- General Farm --</option>
                                {batches.map(batch => (
                                    <option key={batch.id} value={batch.id}>{batch.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="affectedBirdsCount" className="block text-sm font-medium text-gray-700 mb-1">Affected Birds Count (Optional)</label>
                            <input
                                type="number"
                                id="affectedBirdsCount"
                                value={affectedBirdsCount}
                                onChange={(e) => setAffectedBirdsCount(e.target.value)}
                                placeholder="e.g., 100"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                min="1"
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                            <textarea
                                id="description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="e.g., Routine vaccination for Newcastle Disease"
                                rows="2"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                required
                            ></textarea>
                        </div>
                        <div>
                            <label htmlFor="medicationUsed" className="block text-sm font-medium text-gray-700 mb-1">Medication/Vaccine Used (Optional)</label>
                            <select
                                id="medicationUsed"
                                value={medicationUsed}
                                onChange={handleMedicationChange}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                disabled={loadingMedicationInventory}
                            >
                                <option value="">-- Select Medication --</option>
                                {loadingMedicationInventory ? (
                                    <option value="" disabled>Loading medications...</option>
                                ) : medicationInventoryError ? (
                                    <option value="" disabled>Error loading medications</option>
                                ) : medicationInventory.length === 0 ? (
                                    <option value="" disabled>No medication items in inventory</option>
                                ) : (
                                    medicationInventory.map(item => (
                                        <option key={item.id} value={item.name}>{item.name} ({item.currentStock.toFixed(2)} {item.unit} available)</option>
                                    ))
                                )}
                            </select>
                            {medicationInventoryError && <p className="text-red-600 text-xs mt-1">{medicationInventoryError}</p>}
                        </div>
                        <div>
                            <label htmlFor="dosage" className="block text-sm font-medium text-gray-700 mb-1">Dosage (Optional)</label>
                            <input
                                type="text"
                                id="dosage"
                                value={dosage}
                                onChange={(e) => setDosage(e.target.value)}
                                placeholder="e.g., 0.5ml per bird"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                            />
                        </div>
                        <div>
                            <label htmlFor="quantityUsed" className="block text-sm font-medium text-gray-700 mb-1">Quantity Used (for Inventory) {unit ? `(${unit})` : '(Optional)'}</label>
                            <input
                                type="number"
                                id="quantityUsed"
                                value={quantityUsed}
                                onChange={(e) => setQuantityUsed(e.target.value)}
                                placeholder="e.g., 100"
                                step="0.01"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                                min="0"
                            />
                        </div>
                        <div>
                            <label htmlFor="outcome" className="block text-sm font-medium text-gray-700 mb-1">Outcome (Optional)</label>
                            <select
                                id="outcome"
                                value={outcome}
                                onChange={(e) => setOutcome(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                            >
                                <option value="">-- Select Outcome --</option>
                                {outcomes.map(o => (
                                    <option key={o} value={o}>{o}</option>
                                ))}
                            </select>
                        </div>
                        <div className="md:col-span-2">
                            <label htmlFor="healthNotes" className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
                            <textarea
                                id="healthNotes"
                                value={healthNotes}
                                onChange={(e) => setHealthNotes(e.target.value)}
                                placeholder="e.g., All birds responded well"
                                rows="2"
                                className="w-full p-2 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                            ></textarea>
                        </div>
                        <div className="md:col-span-2">
                            <button
                                type="submit"
                                className="w-full bg-teal-600 text-white py-2 px-4 rounded-md hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 transition duration-200 ease-in-out shadow-md"
                            >
                                Record Health Event
                            </button>
                        </div>
                    </form>
                )}
            </div>

            <h2 className="text-2xl font-semibold text-gray-700 mb-4">Health History</h2>
            {healthError && <p className="text-red-600 mb-4">{healthError}</p>}
            {loadingHealth ? (
                <p className="text-gray-500 text-center py-8">Loading health records...</p>
            ) : Object.keys(groupedHealthRecords).length === 0 ? (
                <p className="text-gray-500 text-center py-8">No health records yet.</p>
            ) : (
                <div className="space-y-6">
                    {Object.entries(groupedHealthRecords).map(([groupName, records]) => (
                        <div key={groupName} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                            <h3 className="text-lg font-bold text-gray-800 mb-3">{groupName}</h3>
                            <ul className="divide-y divide-gray-200">
                                {records.map(record => (
                                    <li key={record.id} className="py-3 flex justify-between items-center flex-wrap gap-2">
                                        <div>
                                            <p className="text-sm text-gray-800">
                                                <span className="font-semibold">Date:</span> {record.date}
                                            </p>
                                            <p className="text-sm text-gray-800">
                                                <span className="font-semibold">Event:</span> {record.eventType}
                                            </p>
                                            <p className="text-sm text-gray-800">
                                                <span className="font-semibold">Description:</span> {record.description}
                                            </p>
                                            {record.medicationUsed && (
                                                <p className="text-sm text-gray-800">
                                                    <span className="font-semibold">Medication:</span> {record.medicationUsed}
                                                    {record.dosage && ` (${record.dosage})`}
                                                    {record.quantityUsed && ` - ${record.quantityUsed.toFixed(2)} ${record.unit || ''}`}
                                                </p>
                                            )}
                                            {record.affectedBirdsCount && (
                                                <p className="text-sm text-gray-800">
                                                    <span className="font-semibold">Affected Birds:</span> {record.affectedBirdsCount}
                                                </p>
                                            )}
                                            {record.outcome && (
                                                <p className="text-sm text-gray-800">
                                                    <span className="font-semibold">Outcome:</span> {record.outcome}
                                                </p>
                                            )}
                                            {record.notes && (
                                                <p className="text-xs text-gray-600">
                                                    <span className="font-semibold">Notes:</span> {record.notes}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex space-x-2 mt-2 sm:mt-0">
                                            <button
                                                onClick={() => openEditHealthModal(record)}
                                                className="text-blue-600 hover:text-blue-800 text-sm px-3 py-1 rounded-md border border-blue-600 hover:border-blue-800 transition duration-150"
                                            >
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => openDeleteHealthConfirm(record)}
                                                className="text-red-600 hover:text-red-800 text-sm px-3 py-1 rounded-md border border-red-600 hover:border-red-800 transition duration-150"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            )}

            {isEditHealthModalOpen && (
                <EditHealthModal
                    record={healthRecordToEdit}
                    onClose={() => setIsEditHealthModalOpen(false)}
                    onSave={handleSaveEditedHealth}
                    batches={batches}
                    medicationInventory={medicationInventory}
                    eventTypes={eventTypes}
                    outcomes={outcomes}
                />
            )}

            {isDeleteHealthConfirmOpen && (
                <DeleteHealthConfirmModal
                    record={healthRecordToDelete}
                    onClose={() => setIsDeleteHealthConfirmOpen(false)}
                    onConfirm={handleDeleteHealth}
                    batches={batches}
                />
            )}
        </div>
    );
};

// --- EditHealthModal Component ---
const EditHealthModal = ({ record, onClose, onSave, batches, medicationInventory, eventTypes, outcomes }) => {
    const [editedBatchId, setEditedBatchId] = useState(record.batchId || '');
    const [editedDate, setEditedDate] = useState(record.date);
    const [editedEventType, setEditedEventType] = useState(record.eventType);
    const [editedDescription, setEditedDescription] = useState(record.description);
    const [editedMedicationUsed, setEditedMedicationUsed] = useState(record.medicationUsed || '');
    const [editedDosage, setEditedDosage] = useState(record.dosage || '');
    const [editedQuantityUsed, setEditedQuantityUsed] = useState(record.quantityUsed || '');
    const [editedUnit, setEditedUnit] = useState(record.unit || '');
    const [editedAffectedBirdsCount, setEditedAffectedBirdsCount] = useState(record.affectedBirdsCount || '');
    const [editedOutcome, setEditedOutcome] = useState(record.outcome || '');
    const [editedNotes, setEditedNotes] = useState(record.notes || '');
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        // Set unit based on selected medication
        const selectedMedication = medicationInventory.find(item => item.name === editedMedicationUsed);
        if (selectedMedication) {
            setEditedUnit(selectedMedication.unit);
        } else if (!editedMedicationUsed) {
            setEditedUnit('');
        }
    }, [editedMedicationUsed, medicationInventory]);

    const handleSubmit = (e) => {
        e.preventDefault();
        setErrorMessage('');

        const parsedQuantityUsed = parseFloat(editedQuantityUsed);
        const parsedAffectedBirdsCount = parseInt(editedAffectedBirdsCount, 10);

        if (!editedDate || !editedEventType || !editedDescription) {
            setErrorMessage("Please fill in Date, Event Type, and Description.");
            return;
        }

        if (editedQuantityUsed && (isNaN(parsedQuantityUsed) || parsedQuantityUsed <= 0)) {
            setErrorMessage("Please enter a valid positive number for Quantity Used.");
            return;
        }
        if (editedAffectedBirdsCount && (isNaN(parsedAffectedBirdsCount) || parsedAffectedBirdsCount <= 0)) {
            setErrorMessage("Please enter a valid positive number for Affected Birds Count.");
            return;
        }

        const updatedData = {
            batchId: editedBatchId,
            date: editedDate,
            eventType: editedEventType,
            description: editedDescription,
            medicationUsed: editedMedicationUsed,
            dosage: editedDosage,
            quantityUsed: editedQuantityUsed ? parsedQuantityUsed : null,
            unit: editedUnit,
            affectedBirdsCount: editedAffectedBirdsCount ? parsedAffectedBirdsCount : null,
            outcome: editedOutcome,
            notes: editedNotes
        };
        onSave(updatedData);
    };

    const handleMedicationChange = (e) => {
        const selectedMedicationName = e.target.value;
        setEditedMedicationUsed(selectedMedicationName);
        const selectedMedication = medicationInventory.find(item => item.name === selectedMedicationName);
        if (selectedMedication) {
            setEditedUnit(selectedMedication.unit);
        } else {
            setEditedUnit('');
        }
    };

    const batchNameDisplay = editedBatchId ? (batches.find(b => b.id === editedBatchId)?.name || 'Unknown Batch') : 'General Farm Health';

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">Edit Health Record ({batchNameDisplay})</h2>
                {errorMessage && <p className="text-red-600 mb-4">{errorMessage}</p>}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="editHealthDate" className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                        <input
                            type="date"
                            id="editHealthDate"
                            value={editedDate}
                            onChange={(e) => setEditedDate(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="editEventType" className="block text-sm font-medium text-gray-700 mb-1">Event Type</label>
                        <select
                            id="editEventType"
                            value={editedEventType}
                            onChange={(e) => setEditedEventType(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                        >
                            {eventTypes.map(type => (
                                <option key={type} value={type}>{type}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="editSelectedBatchHealth" className="block text-sm font-medium text-gray-700 mb-1">Select Batch (Optional)</label>
                        <select
                            id="editSelectedBatchHealth"
                            value={editedBatchId}
                            onChange={(e) => setEditedBatchId(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                        >
                            <option value="">-- General Farm --</option>
                            {batches.map(batch => (
                                <option key={batch.id} value={batch.id}>{batch.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="editAffectedBirdsCount" className="block text-sm font-medium text-gray-700 mb-1">Affected Birds Count (Optional)</label>
                        <input
                            type="number"
                            id="editAffectedBirdsCount"
                            value={editedAffectedBirdsCount}
                            onChange={(e) => setEditedAffectedBirdsCount(e.target.value)}
                            placeholder="e.g., 100"
                            className="w-full p-2 border border-gray-300 rounded-md"
                            min="1"
                        />
                    </div>
                    <div className="md:col-span-2">
                        <label htmlFor="editDescription" className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                        <textarea
                            id="editDescription"
                            value={editedDescription}
                            onChange={(e) => setEditedDescription(e.target.value)}
                            placeholder="e.g., Routine vaccination for Newcastle Disease"
                            rows="2"
                            className="w-full p-2 border border-gray-300 rounded-md"
                            required
                        ></textarea>
                    </div>
                    <div>
                        <label htmlFor="editMedicationUsed" className="block text-sm font-medium text-gray-700 mb-1">Medication/Vaccine Used (Optional)</label>
                        <select
                            id="editMedicationUsed"
                            value={editedMedicationUsed}
                            onChange={handleMedicationChange}
                            className="w-full p-2 border border-gray-300 rounded-md"
                        >
                            <option value="">-- Select Medication --</option>
                            {medicationInventory.map(item => (
                                <option key={item.id} value={item.name}>{item.name} ({item.currentStock.toFixed(2)} {item.unit} available)</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="editDosage" className="block text-sm font-medium text-gray-700 mb-1">Dosage (Optional)</label>
                        <input
                            type="text"
                            id="editDosage"
                            value={editedDosage}
                            onChange={(e) => setEditedDosage(e.target.value)}
                            placeholder="e.g., 0.5ml per bird"
                            className="w-full p-2 border border-gray-300 rounded-md"
                        />
                    </div>
                    <div>
                        <label htmlFor="editQuantityUsed" className="block text-sm font-medium text-gray-700 mb-1">Quantity Used (for Inventory) {editedUnit ? `(${editedUnit})` : '(Optional)'}</label>
                        <input
                            type="number"
                            id="editQuantityUsed"
                            value={editedQuantityUsed}
                            onChange={(e) => setEditedQuantityUsed(e.target.value)}
                            placeholder="e.g., 100"
                            step="0.01"
                            className="w-full p-2 border border-gray-300 rounded-md"
                            min="0"
                        />
                    </div>
                    <div>
                        <label htmlFor="editOutcome" className="block text-sm font-medium text-gray-700 mb-1">Outcome (Optional)</label>
                        <select
                            id="editOutcome"
                            value={editedOutcome}
                            onChange={(e) => setEditedOutcome(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md"
                        >
                            <option value="">-- Select Outcome --</option>
                            {outcomes.map(o => (
                                <option key={o} value={o}>{o}</option>
                            ))}
                        </select>
                    </div>
                    <div className="md:col-span-2">
                        <label htmlFor="editHealthNotes" className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
                        <textarea
                            id="editHealthNotes"
                            value={editedNotes}
                            onChange={(e) => setEditedNotes(e.target.value)}
                            placeholder="e.g., All birds responded well"
                            rows="2"
                            className="w-full p-2 border border-gray-300 rounded-md"
                        ></textarea>
                    </div>
                    <div className="flex justify-end space-x-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-150"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition duration-150"
                        >
                            Save Changes
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- DeleteHealthConfirmModal Component ---
const DeleteHealthConfirmModal = ({ record, onClose, onConfirm, batches }) => {
    const batchName = record.batchId ? (batches.find(b => b.id === record.batchId)?.name || record.batchId) : 'General Farm Health';

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm text-center">
                <h2 className="text-xl font-bold text-gray-800 mb-4">Confirm Deletion</h2>
                <p className="text-gray-700 mb-6">
                    Are you sure you want to delete the health record for "<span className="font-semibold">{record?.eventType}</span>" on {record?.date} for batch "<span className="font-semibold">{batchName}</span>"?
                    This action cannot be undone.
                </p>
                <div className="flex justify-center space-x-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 transition duration-150"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition duration-150"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
};





export default App;




