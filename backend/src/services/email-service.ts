import nodemailer from "nodemailer";
import { escapeForHtml } from "../utils/sanitize.js";

interface SendInviteEmailInput {
  to: string;
  inviteLink: string;
  invitedName: string;
  invitedRole: string;
  eligibilityExpiresAt: string;
}

interface SendPasswordResetEmailInput {
  to: string;
  resetLink: string;
  eligibilityExpiresAt: string;
}

interface SendOtpEmailInput {
  to: string;
  otp: string;
  fullName: string;
  expiresInMinutes: number;
}

interface SendWelcomeEmailInput {
  to: string;
  fullName: string;
  orgName: string;
  loginLink: string;
}

let transporter: nodemailer.Transporter | null = null;

const getTransporter = (): nodemailer.Transporter => {
  if (transporter) {
    return transporter;
  }

  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    throw new Error("EMAIL_USER and EMAIL_PASS must be configured");
  }

  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user,
      pass,
    },
  });

  return transporter;
};

export const sendInviteEmail = async (
  input: SendInviteEmailInput,
): Promise<void> => {
  const user = process.env.EMAIL_USER;
  if (!user) {
    throw new Error("EMAIL_USER must be configured");
  }

  const mailer = getTransporter();

  await mailer.sendMail({
    from: `System Pulse <${user}>`,
    to: input.to,
    subject: "You are invited to System Pulse",
    text: `Hello ${input.invitedName},\n\nYou have been invited as ${input.invitedRole}.\n\nComplete registration here: ${input.inviteLink}\n\nEligibility expires at: ${input.eligibilityExpiresAt}.`,
    html:
      `<p>Hello ${escapeForHtml(input.invitedName)},</p>` +
      `<p>You have been invited as <strong>${escapeForHtml(input.invitedRole)}</strong>.</p>` +
      `<p>Complete registration here:<br/>` +
      `<a href="${escapeForHtml(input.inviteLink)}">${escapeForHtml(input.inviteLink)}</a></p>` +
      `<p>Eligibility expires at: <strong>${escapeForHtml(input.eligibilityExpiresAt)}</strong>.</p>`,
  });
};

export const sendPasswordResetEmail = async (
  input: SendPasswordResetEmailInput,
): Promise<void> => {
  const user = process.env.EMAIL_USER;
  if (!user) {
    throw new Error("EMAIL_USER must be configured");
  }

  const mailer = getTransporter();

  await mailer.sendMail({
    from: `System Pulse <${user}>`,
    to: input.to,
    subject: "Reset your System Pulse password",
    text: `A password reset was requested for your account.\n\nReset your password here: ${input.resetLink}\n\nEligibility expires at: ${input.eligibilityExpiresAt}.\n\nIf you did not request this, you can ignore this email.`,
    html:
      `<p>A password reset was requested for your account.</p>` +
      `<p>Reset your password here:<br/>` +
      `<a href="${escapeForHtml(input.resetLink)}">${escapeForHtml(input.resetLink)}</a></p>` +
      `<p>Eligibility expires at: <strong>${escapeForHtml(input.eligibilityExpiresAt)}</strong>.</p>` +
      `<p>If you did not request this, you can ignore this email.</p>`,
  });
};

export const sendOtpEmail = async (input: SendOtpEmailInput): Promise<void> => {
  const user = process.env.EMAIL_USER;
  if (!user) {
    throw new Error("EMAIL_USER must be configured");
  }

  const mailer = getTransporter();

  // OTP itself is server-generated and numeric, but we still escape
  // it (and the user-provided fullName) for defense-in-depth in case
  // the format is ever loosened.
  await mailer.sendMail({
    from: `System Pulse <${user}>`,
    to: input.to,
    subject: `Your System Pulse verification code: ${input.otp}`,
    text:
      `Hello ${input.fullName},\n\n` +
      `Your verification code is: ${input.otp}\n\n` +
      `This code expires in ${input.expiresInMinutes} minutes.\n\n` +
      `If you didn't request this code, you can safely ignore this email.`,
    html:
      `<p>Hello ${escapeForHtml(input.fullName)},</p>` +
      `<p>Your verification code is:</p>` +
      `<p style="font-size:28px;letter-spacing:6px;font-weight:bold;font-family:monospace;">${escapeForHtml(input.otp)}</p>` +
      `<p>This code expires in <strong>${input.expiresInMinutes} minutes</strong>.</p>` +
      `<p>If you didn't request this code, you can safely ignore this email.</p>`,
  });
};

export const sendWelcomeEmail = async (
  input: SendWelcomeEmailInput,
): Promise<void> => {
  const user = process.env.EMAIL_USER;
  if (!user) {
    throw new Error("EMAIL_USER must be configured");
  }

  const mailer = getTransporter();

  await mailer.sendMail({
    from: `System Pulse <${user}>`,
    to: input.to,
    subject: `Welcome to System Pulse, ${input.fullName}!`,
    text:
      `Hello ${input.fullName},\n\n` +
      `Welcome to System Pulse!\n\n` +
      `Your free organization "${input.orgName}" is ready. ` +
      `As an admin you can add unlimited systems and invite users.\n\n` +
      `Sign in here: ${input.loginLink}\n\n` +
      `Happy monitoring!`,
    html:
      `<p>Hello ${escapeForHtml(input.fullName)},</p>` +
      `<p>Welcome to <strong>System Pulse</strong>!</p>` +
      `<p>Your free organization <strong>${escapeForHtml(input.orgName)}</strong> is ready. ` +
      `As an admin you can add unlimited systems and invite users.</p>` +
      `<p><a href="${escapeForHtml(input.loginLink)}">Sign in to your dashboard</a></p>` +
      `<p>Happy monitoring!</p>`,
  });
};
