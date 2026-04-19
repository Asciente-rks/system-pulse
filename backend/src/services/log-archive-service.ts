import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

export interface HealthLogArchiveInput {
  systemId: string;
  checkedAt: string;
  payload: Record<string, unknown>;
}

export const archiveHealthLogToS3 = async (
  input: HealthLogArchiveInput,
): Promise<void> => {
  const enabled = process.env.ENABLE_S3_ARCHIVE === "true";
  if (!enabled) {
    return;
  }

  const bucket = process.env.HEALTH_LOGS_BUCKET;

  if (!bucket) {
    console.warn("HEALTH_LOGS_BUCKET is not configured; skipping S3 archive");
    return;
  }

  const safeTimestamp = input.checkedAt.replace(/[:.]/g, "-");
  const key = `health-logs/${input.systemId}/${safeTimestamp}.json`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(input.payload, null, 2),
      ContentType: "application/json",
    }),
  );
};
