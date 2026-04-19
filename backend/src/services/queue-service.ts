import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { HealthCheckQueueMessage } from "../types/health-events.js";

const sqsClient = new SQSClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

export const enqueueHealthCheck = async (
  message: HealthCheckQueueMessage,
  delaySeconds = 0,
): Promise<string | undefined> => {
  const queueUrl = process.env.HEALTH_CHECK_QUEUE_URL;

  if (!queueUrl) {
    throw new Error("HEALTH_CHECK_QUEUE_URL environment variable is not set");
  }

  const safeDelay = Math.max(0, Math.min(delaySeconds, 900));

  const result = await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      DelaySeconds: safeDelay,
      MessageBody: JSON.stringify(message),
    }),
  );

  return result.MessageId;
};
