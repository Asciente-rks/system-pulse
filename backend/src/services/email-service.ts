import nodemailer from "nodemailer";

interface SendInviteEmailInput {
  to: string;
  inviteLink: string;
  invitedName: string;
  invitedRole: string;
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
    text: `Hello ${input.invitedName},\n\nYou have been invited as ${input.invitedRole}.\n\nComplete registration here: ${input.inviteLink}\n\nThis invitation expires in 24 hours.`,
    html: `<p>Hello ${input.invitedName},</p><p>You have been invited as <strong>${input.invitedRole}</strong>.</p><p>Complete registration here:<br/><a href="${input.inviteLink}">${input.inviteLink}</a></p><p>This invitation expires in 24 hours.</p>`,
  });
};
