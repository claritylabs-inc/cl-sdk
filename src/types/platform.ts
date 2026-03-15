// Platform and communication intent types for multi-modal agent support

export type Platform = "email" | "chat" | "sms" | "slack" | "discord";

export type CommunicationIntent = "direct" | "mediated" | "observed";

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
}
