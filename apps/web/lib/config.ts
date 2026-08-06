import { PublicKey } from "@solana/web3.js";
import { z } from "zod";

const pubkeyString = z.string().trim().min(1, "is required").refine(
  (value) => {
    try {
      new PublicKey(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: "must be a valid base58 public key" },
);

const urlString = z.string().trim().min(1, "is required").refine(
  (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "must be a valid http(s) URL" },
);

const envSchema = z.object({
  rpcUrl: urlString,
  programId: pubkeyString,
  stakeMint: pubkeyString,
});

export type VaultConfig = {
  rpcUrl: string;
  programId: PublicKey;
  stakeMint: PublicKey;
};

export interface ConfigIssue {
  field: string;
  message: string;
}

interface ConfigResult {
  config: VaultConfig | null;
  issues: ConfigIssue[];
}

function loadConfig(): ConfigResult {
  const raw = {
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
    programId: process.env.NEXT_PUBLIC_PROGRAM_ID,
    stakeMint: process.env.NEXT_PUBLIC_STAKE_MINT,
  };

  const varNames: Record<keyof typeof raw, string> = {
    rpcUrl: "NEXT_PUBLIC_RPC_URL",
    programId: "NEXT_PUBLIC_PROGRAM_ID",
    stakeMint: "NEXT_PUBLIC_STAKE_MINT",
  };

  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const field = issue.path[0] as keyof typeof raw;
      return { field: varNames[field] ?? String(field), message: issue.message };
    });
    return { config: null, issues };
  }

  return {
    config: {
      rpcUrl: parsed.data.rpcUrl,
      programId: new PublicKey(parsed.data.programId),
      stakeMint: new PublicKey(parsed.data.stakeMint),
    },
    issues: [],
  };
}

const { config, issues } = loadConfig();

/** Validated app config, or `null` if any required NEXT_PUBLIC_* env var is missing/invalid. */
export { config, issues as configIssues };
