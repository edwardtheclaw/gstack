---
name: setup-gstack-upload
version: 1.0.0
description: |
  Step‑by‑step guide to configure AWS S3 for gstack screenshot/image uploads.
  Creates a public‑read bucket, sets CORS for web hosting, provisions an IAM user
  with s3:PutObject permissions, stores credentials in ~/.gstack/upload.json,
  and verifies the setup with a test upload + accessible URL.
allowed-tools:
  - Bash
  - AWS CLI

---

# Setup gstack Upload (S3 Configuration)

This skill configures an AWS S3 bucket and IAM user to receive screenshots and images uploaded by `gstack`. The result is a `~/.gstack/upload.json` credential file and a working public‑read bucket with CORS enabled for web hosting.

## Prerequisites

- An active [AWS account](https://aws.amazon.com/) with programmatic access
- AWS CLI installed and configured (`aws configure` run)
- Permissions to create S3 buckets and IAM users

## Steps

### 1. Create S3 bucket with public read access

```bash
# Choose a globally unique bucket name (lowercase, no underscores)
BUCKET_NAME="gstack-uploads-$(date +%Y%m%d)-$(openssl rand -hex 4)"

# Create the bucket (replace region if needed)
aws s3api create-bucket \
  --bucket "$BUCKET_NAME" \
  --region us-east-1 \
  --acl private

# Enable public read for objects (bucket policy)
cat > /tmp/bucket-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::$BUCKET_NAME/*"
    }
  ]
}
EOF

aws s3api put-bucket-policy \
  --bucket "$BUCKET_NAME" \
  --policy file:///tmp/bucket-policy.json
```

**Note:** Replace `us‑east‑1` with your preferred region. For regions other than `us‑east‑1` you must also add `--create-bucket-configuration LocationConstraint=region`.

### 2. Configure CORS for image hosting

Create a CORS configuration that allows web pages to fetch uploaded images:

```bash
cat > /tmp/cors.json << EOF
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET"],
      "AllowedOrigins": ["*"],
      "ExposeHeaders": []
    }
  ]
}
EOF

aws s3api put-bucket-cors \
  --bucket "$BUCKET_NAME" \
  --cors-configuration file:///tmp/cors.json
```

### 3. Create IAM user with s3:PutObject permission

```bash
USER_NAME="gstack-uploader-$(date +%Y%m%d)"

# Create the IAM user
aws iam create-user --user-name "$USER_NAME"

# Attach an inline policy granting PutObject only to this bucket
cat > /tmp/user-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::$BUCKET_NAME/*"
    }
  ]
}
EOF

aws iam put-user-policy \
  --user-name "$USER_NAME" \
  --policy-name "S3PutObjectOnly" \
  --policy-document file:///tmp/user-policy.json

# Generate access keys
CREDS=$(aws iam create-access-key --user-name "$USER_NAME")
```

### 4. Store credentials in ~/.gstack/upload.json

```bash
mkdir -p ~/.gstack

# Extract keys from the JSON output (requires jq)
ACCESS_KEY=$(echo "$CREDS" | jq -r '.AccessKey.AccessKeyId')
SECRET_KEY=$(echo "$CREDS" | jq -r '.AccessKey.SecretAccessKey')

cat > ~/.gstack/upload.json << EOF
{
  "bucket": "$BUCKET_NAME",
  "region": "us-east-1",
  "accessKeyId": "$ACCESS_KEY",
  "secretAccessKey": "$SECRET_KEY",
  "baseUrl": "https://$BUCKET_NAME.s3.amazonaws.com"
}
EOF

chmod 600 ~/.gstack/upload.json
```

**Security:** The `upload.json` file contains sensitive credentials. Keep it readable only by the current user.

### 5. Verification

Upload a test file and confirm its URL is publicly accessible:

```bash
echo "Hello from gstack upload test" > /tmp/test-upload.txt

# Upload using the stored credentials
AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
AWS_REGION="us-east-1" \
  aws s3 cp /tmp/test-upload.txt "s3://$BUCKET_NAME/test-upload.txt" \
  --acl public-read

# Construct the public URL
PUBLIC_URL="https://$BUCKET_NAME.s3.amazonaws.com/test-upload.txt"

# Fetch the file (should return "Hello from gstack upload test")
curl -s "$PUBLIC_URL"

# Clean up test object (optional)
AWS_ACCESS_KEY_ID="$ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$SECRET_KEY" \
  aws s3 rm "s3://$BUCKET_NAME/test-upload.txt"
```

If the `curl` returns the test content, the setup is complete and gstack can use `~/.gstack/upload.json` to upload screenshots.

## Full Script

A single script that performs all steps (requires `jq` installed) is available at [scripts/setup-gstack-upload.sh](scripts/setup-gstack-upload.sh).

## Troubleshooting

- **Bucket already exists**: Choose a different bucket name (must be globally unique).
- **Access denied**: Ensure your AWS CLI credentials have permissions for S3 bucket creation and IAM user management.
- **CORS not working**: Verify the CORS configuration with `aws s3api get-bucket-cors --bucket $BUCKET_NAME`.
- **Upload fails**: Check that the IAM user’s policy is attached and the bucket policy allows `GetObject` from `*`.

## Cleanup

To remove the created resources:

```bash
# Delete the IAM user and access keys
aws iam delete-user-policy --user-name "$USER_NAME" --policy-name "S3PutObjectOnly"
aws iam delete-access-key --user-name "$USER_NAME" --access-key-id "$ACCESS_KEY"
aws iam delete-user --user-name "$USER_NAME"

# Empty and delete the bucket
aws s3 rm "s3://$BUCKET_NAME" --recursive
aws s3api delete-bucket --bucket "$BUCKET_NAME"

# Remove local credential file
rm ~/.gstack/upload.json
```

## Next Steps

Once the upload configuration is in place, gstack’s `screenshot` and `upload` commands will automatically use the S3 bucket, returning public URLs suitable for sharing in bug reports or documentation.