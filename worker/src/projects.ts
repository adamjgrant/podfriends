export interface ProjectBindings {
  PROJECT_NOTES_DB: D1Database;
  PROJECT_PODFRIENDS_DB: D1Database;
}

export type AccessMode = "owner_only" | "allowlist" | "public";

export interface ProjectConfig {
  id: string;
  dbBinding: keyof ProjectBindings;
  allowedOrigins: string[];
  accessMode: AccessMode;
  allowedEmails?: string[];
}

export const PROJECTS: Record<string, ProjectConfig> = {
  podfriends: {
    id: "podfriends",
    dbBinding: "PROJECT_PODFRIENDS_DB",
    allowedOrigins: ["https://side-project-bridge.smosa.workers.dev", "http://localhost:8787", "http://localhost:3000", "http://localhost:5173", "http://localhost:8080", "http://127.0.0.1:5500", "https://adamjgrant.github.io"],
    accessMode: "public",
  },
  notes: {
    id: "notes",
    dbBinding: "PROJECT_NOTES_DB",
    allowedOrigins: [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:8080",
      "http://127.0.0.1:5500",
      "https://adamjgrant.github.io",
    ],
    accessMode: "owner_only",
    allowedEmails: [],
  },
};

export function getAllAllowedOrigins(): string[] {
  const origins = new Set<string>();
  for (const project of Object.values(PROJECTS)) {
    for (const origin of project.allowedOrigins) {
      origins.add(origin);
    }
  }
  return Array.from(origins);
}
