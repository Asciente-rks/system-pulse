import nodemailer from "nodemailer";

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
    html: `<p>Hello ${input.invitedName},</p><p>You have been invited as <strong>${input.invitedRole}</strong>.</p><p>Complete registration here:<br/><a href="${input.inviteLink}">${input.inviteLink}</a></p><p>Eligibility expires at: <strong>${input.eligibilityExpiresAt}</strong>.</p>`,
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
    html: `<p>A password reset was requested for your account.</p><p>Reset your password here:<br/><a href="${input.resetLink}">${input.resetLink}</a></p><p>Eligibility expires at: <strong>${input.eligibilityExpiresAt}</strong>.</p><p>If you did not request this, you can ignore this email.</p>`,
  });
};
