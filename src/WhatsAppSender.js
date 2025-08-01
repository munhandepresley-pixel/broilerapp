import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';

// The functions instance will now be passed as a prop from the parent component
const WhatsAppSender = ({ functions }) => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  // Function to call the deployed Firebase Function
  const callCloudFunction = async () => {
    setLoading(true);
    setStatus('Sending message...');

    // Use the name of your deployed function
    const sendWhatsAppMessage = httpsCallable(functions, 'broilerapp-sendTestWhatsAppMessage');

    try {
      // Call the function with the recipient and message data
      const result = await sendWhatsAppMessage({ to: phoneNumber, message });
      setStatus(`Success: ${result.data.message}`);
      console.log('Function call successful:', result.data);
    } catch (error) {
      setStatus(`Error: ${error.message}`);
      console.error('Function call failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-xl shadow-lg">
        <h1 className="text-3xl font-bold text-center text-gray-800">Send WhatsApp Message</h1>
        
        <div className="space-y-4">
          <div>
            <label htmlFor="phoneNumber" className="text-sm font-medium text-gray-700">Phone Number (E.164 format)</label>
            <input
              type="text"
              id="phoneNumber"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="e.g., +14155552671"
              className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            />
          </div>
          <div>
            <label htmlFor="message" className="text-sm font-medium text-gray-700">Message</label>
            <textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows="4"
              placeholder="Enter your message here..."
              className="mt-1 block w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
            ></textarea>
          </div>
        </div>

        <button
          onClick={callCloudFunction}
          disabled={loading || !phoneNumber || !message || !functions}
          className="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-300 transition duration-150 ease-in-out"
        >
          {loading ? 'Sending...' : 'Send Message'}
        </button>

        {status && (
          <p className={`text-center text-sm font-medium ${status.includes('Error') ? 'text-red-600' : 'text-green-600'}`}>
            {status}
          </p>
        )}
      </div>
    </div>
  );
};

export default WhatsAppSender;
