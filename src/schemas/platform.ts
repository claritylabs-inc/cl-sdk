import { z } from "zod";

// ── Platform ──

export const PlatformSchema = z.enum(["email", "chat", "sms", "slack", "discord"]);
export type Platform = z.infer<typeof PlatformSchema>;

// ── CommunicationIntent ──

export const CommunicationIntentSchema = z.enum(["direct", "mediated", "observed"]);
export type CommunicationIntent = z.infer<typeof CommunicationIntentSchema>;

// ── PlatformConfig (plain interface — runtime constant, not validated data) ──

export interface PlatformConfig {
  supportsMarkdown: boolean;
  supportsLinks: boolean;
  supportsRichFormatting: boolean;
  maxResponseLength?: number;
  signOff?: boolean;
}

export const PLATFORM_CONFIGS: Record<Platform, PlatformConfig> = {
  email: {
    supportsMarkdown: false,
    supportsLinks: true,
    supportsRichFormatting: false,
    signOff: true,
  },
  chat: {
    supportsMarkdown: true,
    supportsLinks: true,
    supportsRichFormatting: true,
  },
  sms: {
    supportsMarkdown: false,
    supportsLinks: false,
    supportsRichFormatting: false,
    maxResponseLength: 1600,
  },
  slack: {
    supportsMarkdown: true,
    supportsLinks: true,
    supportsRichFormatting: true,
  },
  discord: {
    supportsMarkdown: true,
    supportsLinks: true,
    supportsRichFormatting: true,
    maxResponseLength: 2000,
  },
};

// ── AgentContext (plain interface — runtime config, not validated data) ──

export interface AgentContext {
  platform: Platform;
  intent: CommunicationIntent;
  platformConfig?: PlatformConfig;
  companyName?: string;
  companyContext?: string;
  siteUrl: string;
  userName?: string;
  coiHandling?: "broker" | "user" | "member" | "ignore";
  brokerName?: string;
  brokerContactName?: string;
  brokerContactEmail?: string;
  /** Display name for the AI agent. Defaults to "CL-0 Agent" if not set. */
  agentName?: string;
  /** Custom link guidance for the AI. Replaces the default policy/quote link examples.
   *  Should include markdown link examples showing the AI how to format document links.
   *  Only used when the platform supports links and intent is "direct". */
  linkGuidance?: string;
}
