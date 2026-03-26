#!/bin/bash
# LocalStack init script — runs after LocalStack is ready.
# Creates the S3 bucket defined in S3_BUCKET (falls back to "documind-dev").
set -e

BUCKET="${S3_BUCKET:-documind-dev}"
REGION="${DEFAULT_REGION:-us-east-1}"

echo "Creating S3 bucket: $BUCKET (region: $REGION)"
awslocal s3 mb "s3://$BUCKET" --region "$REGION" 2>/dev/null || echo "Bucket $BUCKET already exists"
awslocal s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedHeaders": ["*"]
  }]
}'
echo "LocalStack S3 ready — bucket: $BUCKET"
