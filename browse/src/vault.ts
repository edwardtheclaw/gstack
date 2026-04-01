/**
 * Auth vault — encrypted credential storage
 *
 * Stores credentials in AES-256-GCM encrypted JSON.
 * LLM never sees passwords — only vault names are listed.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';

interface Credential {
  name: string;
  username: string;
  password: string;
}

interface VaultData {
  version: 1;
  credentials: Credential[];
}

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/** Derive a 256-bit key from a master password */
function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(masterKey, salt, 100000, KEY_LENGTH, 'sha256');
}

/** Encrypt plaintext with AES-256-GCM */
function encrypt(plaintext: string, masterKey: string): Buffer {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(masterKey, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Format: salt(16) + iv(12) + tag(16) + ciphertext
  return Buffer.concat([salt, iv, tag, encrypted]);
}

/** Decrypt AES-256-GCM ciphertext */
function decrypt(data: Buffer, masterKey: string): string {
  const salt = data.subarray(0, 16);
  const iv = data.subarray(16, 28);
  const tag = data.subarray(28, 44);
  const ciphertext = data.subarray(44);

  const key = deriveKey(masterKey, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  return decipher.update(ciphertext) + decipher.final('utf8');
}

/** Read and decrypt vault file, or return empty vault */
function readVault(vaultPath: string, masterKey: string): VaultData {
  if (!fs.existsSync(vaultPath)) {
    return { version: 1, credentials: [] };
  }
  const raw = fs.readFileSync(vaultPath);
  const json = decrypt(raw, masterKey);
  return JSON.parse(json) as VaultData;
}

/** Encrypt and write vault to file */
function writeVault(vaultPath: string, vault: VaultData, masterKey: string): void {
  const json = JSON.stringify(vault, null, 2);
  const encrypted = encrypt(json, masterKey);
  fs.writeFileSync(vaultPath, encrypted, { mode: 0o600 });
}

const DEFAULT_VAULT_PATH = '/tmp/browse-vault.enc';

export function addCredential(
  name: string, username: string, password: string, masterKey: string,
  vaultPath: string = DEFAULT_VAULT_PATH
): void {
  const vault = readVault(vaultPath, masterKey);
  const existing = vault.credentials.findIndex(c => c.name === name);
  if (existing !== -1) {
    vault.credentials[existing] = { name, username, password };
  } else {
    vault.credentials.push({ name, username, password });
  }
  writeVault(vaultPath, vault, masterKey);
}

export function removeCredential(
  name: string, masterKey: string,
  vaultPath: string = DEFAULT_VAULT_PATH
): void {
  const vault = readVault(vaultPath, masterKey);
  const idx = vault.credentials.findIndex(c => c.name === name);
  if (idx === -1) throw new Error(`Credential '${name}' not found`);
  vault.credentials.splice(idx, 1);
  writeVault(vaultPath, vault, masterKey);
}

export function listNames(
  masterKey: string,
  vaultPath: string = DEFAULT_VAULT_PATH
): string[] {
  const vault = readVault(vaultPath, masterKey);
  return vault.credentials.map(c => c.name);
}

export function getCredential(
  name: string, masterKey: string,
  vaultPath: string = DEFAULT_VAULT_PATH
): { username: string; password: string } {
  const vault = readVault(vaultPath, masterKey);
  const cred = vault.credentials.find(c => c.name === name);
  if (!cred) throw new Error(`Credential '${name}' not found`);
  return { username: cred.username, password: cred.password };
}
