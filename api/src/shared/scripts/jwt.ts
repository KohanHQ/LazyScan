import { randomBytes } from "crypto";

function generateJWTSecret(length: number = 64): string {
  return randomBytes(length).toString('base64url');
}

function main() {
  const secret = generateJWTSecret();
  
  console.log("Generated JWT Secret:");
  console.log(secret);
  console.log("");
  console.log("Add this to your .env file:");
  console.log(`JWT_SECRET=${secret}`);
  console.log("");
  console.log(`Secret length: ${secret.length} characters`);
}

if (import.meta.main) {
  main();
}