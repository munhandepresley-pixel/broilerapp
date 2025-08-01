// functions/index.js

const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
// You don't need to pass credentials explicitly when deploying to Cloud Functions
// as it automatically uses the service account.
admin.initializeApp();

/**
 * Callable Cloud Function to set custom user claims.
 * This function should be protected, ideally called from a trusted server,
 * or with proper authentication if called directly from a client.
 * For simplicity, this example just takes the uid and claims.
 *
 * @param {string} data.uid - The user ID for whom to set claims.
 * @param {object} data.claims - An object containing the custom claims to set.
 */
exports.setCustomUserClaims = functions.https.onCall(async (data, context) => {
  // Optional: For production, you would typically add authentication/authorization checks here.
  // For example, to ensure only an admin user can call this function:
  // if (!context.auth || context.auth.token.role !== 'admin') {
  //   throw new functions.https.HttpsError('permission-denied', 'Only authorized users can call this function.');
  // }

  const uid = data.uid;
  const claims = data.claims;

  if (!uid || typeof claims !== 'object' || claims === null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'The function must be called with a user ID (uid) and an object of claims.'
    );
  }

  try {
    // Set the custom claims
    await admin.auth().setCustomUserClaims(uid, claims);

    // Optionally, get the user record to verify the claims were set
    const userRecord = await admin.auth().getUser(uid);
    console.log(`Custom claims set for user ${uid}:`, userRecord.customClaims);

    return {
      message: `Custom claims successfully set for user ${uid}.`,
      claimsSet: userRecord.customClaims,
    };
  } catch (error) {
    console.error('Error setting custom user claims:', error);
    throw new functions.https.HttpsError('internal', 'Unable to set custom user claims.', error.message);
  }
});