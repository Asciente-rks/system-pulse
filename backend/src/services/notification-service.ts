import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import type { HealthStatusEvent } from "../types/health-events.js";

const snsClient = new SNSClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

export const publishHealthStatusEvent = async (
  event: HealthStatusEvent,
): Promise<void> => {
  const enabled = process.env.ENABLE_SNS_NOTIFICATIONS === "true";
  if (!enabled) {
    return;
  }

  const topicArn = process.env.HEALTH_STATUS_TOPIC_ARN;

  if (!topicArn) {
    console.warn(
      "HEALTH_STATUS_TOPIC_ARN is not configured; skipping SNS publish",
    );
    return;
  }

  await snsClient.send(
    new PublishCommand({
      TopicArn: topicArn,
      Subject: `System ${event.systemName} is ${event.status}`,
      Message: JSON.stringify(event),
    }),
  );
};
