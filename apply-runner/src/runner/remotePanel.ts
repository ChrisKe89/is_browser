import { REMOTE_PANEL_PROFILE } from "../../../packages/platform/src/env.js";
import { readFile } from "node:fs/promises";

type RemotePanelAction = {
  action: "click" | "type" | "key" | "wait";
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  delayMs?: number;
};

type RemotePanelProfile = {
  id: string;
  name: string;
  viewport?: { width: number; height: number };
  steps: RemotePanelAction[];
};

type RemotePanelConfig = {
  profiles: RemotePanelProfile[];
};

export async function runRemotePanel(
  page: import("playwright").Page,
  panelUrl: string,
  settings: { profileId?: string; steps?: RemotePanelAction[] }
): Promise<void> {
  await page.goto(panelUrl, { waitUntil: "networkidle" });
  const profile = await loadProfile(settings.profileId ?? REMOTE_PANEL_PROFILE);
  const steps = settings.steps?.length ? settings.steps : profile?.steps ?? [];
  if (profile?.viewport) {
    await page.setViewportSize(profile.viewport);
  }

  for (const step of steps) {
    if (step.delayMs) {
      await page.waitForTimeout(step.delayMs);
    }
    if (step.action === "click" && step.x !== undefined && step.y !== undefined) {
      await page.mouse.click(step.x, step.y);
    } else if (step.action === "type" && step.text) {
      await page.keyboard.type(step.text);
    } else if (step.action === "key" && step.key) {
      await page.keyboard.press(step.key);
    } else if (step.action === "wait" && step.delayMs) {
      await page.waitForTimeout(step.delayMs);
    }
  }
}

async function loadProfile(id: string): Promise<RemotePanelProfile | undefined> {
  try {
    const raw = await readFile("config/remote-panel-profiles.json", "utf8");
    const data = JSON.parse(raw) as RemotePanelConfig;
    return data.profiles.find((profile) => profile.id === id);
  } catch {
    return undefined;
  }
}

