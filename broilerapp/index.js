/**
 * @file Cloud function to send a test WhatsApp message using Twilio.
 * This file is part of the broilerapp codebase.
 */
const {onCall} = require("firebase-functions/v2/https");
const {Twilio} = require("twilio");

// Load environment variables from the .env file.
require("dotenv").config();

// Access environment variables using process.env
const accountSid = process.env.TWILIO_SID;
const authToken = process.env.TWILIO_TOKEN;
const whatsAppSandboxNumber = process.env.TWILIO_SANDBOX_NUMBER;

// Correctly instantiate the Twilio client using the imported class.
const client = new Twilio(accountSid, authToken);

/**
 * Cloud Function to send a WhatsApp message (2nd Generation).
 * This function can only be called from a trusted client application.
 * @param {object} request The request object passed to the function call.
 * @returns {Promise<object>} The result of the Twilio API call or an error object.
 */
exports.sendTestWhatsAppMessage = onCall(async (request) => {
  // Check if the call is from a verified user.
  // This is a crucial security check.
  if (!request.auth) {
    throw new Error("The function must be called while authenticated.");
  }

  // Validate the input data.
  const {to, message} = request.data;
  if (!to || !message) {
    throw new Error("The function requires a `to` number and a `message` text.");
  }

  try {
    const twilioMessage = await client.messages.create({
      contentSid: "HX33f0011409f5835697621c43b0d2d341",
      messagingServiceSid: "MGd01f9d78453483984d0089e602492f59",
      from: whatsAppSandboxNumber,
      to: to,
    });

    // The Twilio API response is a detailed object.
    // We only return a simple success message for the client app.
    return {
      success: true,
      sid: twilioMessage.sid,
      status: twilioMessage.status,
      message: "WhatsApp message successfully queued by Twilio.",
    };
  } catch (error) {
    // Log the detailed error to Firebase logs for debugging
    console.error("Twilio API Error:", error);

    // Return a public error message to the client.
    throw new Error(`An error occurred while sending the message: ${error.message}`);
  }
});
