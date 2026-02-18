"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ProfileRecord } from "../lib/types";

export function HomeClient() {
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadProfiles() {
    const response = await fetch("/api/profiles", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Failed to load profiles");
    }
    const payload = (await response.json()) as { profiles: ProfileRecord[] };
    setProfiles(payload.profiles);
  }

  useEffect(() => {
    loadProfiles().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to load profiles");
    });
  }, []);

  const canCreate = useMemo(() => account.trim().length > 0 && !saving, [account, saving]);

  async function createProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const response = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: account.trim(), name: name.trim() || null }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Profile create failed");
      }
      const payload = (await response.json()) as { profile: ProfileRecord };
      window.location.href = `/profiles/${payload.profile.id}`;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Profile create failed");
      setSaving(false);
    }
  }

  return (
    <main className="page">
      <section className="card">
        <h1 className="title">is_form Profiles</h1>
        <p className="subtitle">
          Create a profile with an Account key, then edit deterministic settings.
        </p>
        <form onSubmit={createProfile}>
          <div className="grid">
            <div>
              <label htmlFor="account">Account</label>
              <input
                id="account"
                value={account}
                onChange={(event) => setAccount(event.target.value)}
                required
                placeholder="ACME-001"
              />
            </div>
            <div>
              <label htmlFor="name">Profile Name</label>
              <input
                id="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="submit" disabled={!canCreate}>
              {saving ? "Creating..." : "Create Profile"}
            </button>
          </div>
        </form>
        {error ? <p className="muted">{error}</p> : null}
      </section>

      <section className="card">
        <h2 className="section-heading">Existing Profiles</h2>
        {profiles.length === 0 ? (
          <p className="muted">No profiles yet.</p>
        ) : (
          <div>
            {profiles.map((profile) => (
              <p key={profile.id}>
                <Link href={`/profiles/${profile.id}`}>
                  {profile.account}
                  {profile.name ? ` - ${profile.name}` : ""}
                </Link>
              </p>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
