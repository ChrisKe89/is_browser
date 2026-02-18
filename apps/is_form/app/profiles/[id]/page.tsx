import { ProfileEditorClient } from "../../../src/components/ProfileEditorClient";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProfileEditorClient profileId={id} />;
}
