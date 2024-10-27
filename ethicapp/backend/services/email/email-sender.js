import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { SES } from '@aws-sdk/client-ses';

const decrypt = (encryptedText) => {
  try {    
    // Parse key and IV as buffers using the 'hex' encoding
    const key = Buffer.from(process.env.CREDENTIALS_SECRET_KEY, 'hex');
    const iv = Buffer.from(process.env.CREDENTIALS_IV, 'hex');
    
    // Ensure key and IV are correct length
    if (key.length !== 32) throw new Error("Invalid key length. Key must be 32 bytes for AES-256-CBC.");
    if (iv.length !== 16) throw new Error("Invalid IV length. IV must be 16 bytes for AES-256-CBC.");

    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;

  } catch (error) {
    console.error("Error during decryption:", error.message);
    throw error;  // Re-throw error for higher-level handling
  }
};

const transporters = {
  development: () => nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: decrypt(process.env.GMAIL_USER_ENCRYPTED),
      pass: decrypt(process.env.GMAIL_PASS_ENCRYPTED),
    },
  }),
  production: () => nodemailer.createTransport({
    SES: new SES({
      region: process.env.AWS_REGION,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }),
  }),
};

const createTransporter = () => {
  const env = process.env.ETHICAPP_ENV || 'development';
  return (transporters[env] || transporters['development'])();
};

export const sendEmail = async (to, subject, htmlContent, attachments = []) => {
  const transporter = createTransporter();

  attachments.forEach(att => {
    att.path = `./backend/services/email/attachments/${att.filename}`;
  });

  try {
    console.log(JSON.stringify(attachments));
    await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to,
      subject,
      html: htmlContent,
      attachments, // Optional array of attachments
    });
    console.log('Email sent successfully');
  } catch (error) {
    console.error('Error sending email:', error);
  }
};


