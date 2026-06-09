import { useEffect, useState } from "react";
import { getTaste, saveTaste, type UserProfilePayload } from "../api";

const emptyProfile: UserProfilePayload = {
  taste: "",
  routines: "",
  playlists: "{}",
  moodRules: ""
};

export function ProfileView() {
  const [profile, setProfile] = useState<UserProfilePayload>(emptyProfile);
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    getTaste()
      .then(setProfile)
      .catch(() => setStatus("failed to load"));
  }, []);

  async function save() {
    setStatus("saving");
    try {
      const next = await saveTaste(profile);
      setProfile(next);
      setStatus("saved");
    } catch {
      setStatus("failed to save");
    }
  }

  return (
    <section className="panel">
      <h1>Profile</h1>
      {(["taste", "routines", "playlists", "moodRules"] as const).map((key) => (
        <label key={key}>
          <span>{key}</span>
          <textarea
            value={profile[key]}
            onChange={(event) => setProfile({ ...profile, [key]: event.target.value })}
          />
        </label>
      ))}
      <button onClick={() => void save()}>Save</button>
      <p>{status}</p>
    </section>
  );
}
