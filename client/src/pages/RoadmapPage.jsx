import Topbar from "../components/Topbar.jsx";

// TODO(migration): port from the matching *.html page + related public/js
// module(s). See client/MIGRATION.md for the source mapping.

export default function RoadmapPage() {
  return (
    <div>
      <Topbar />
      <div className="lb-wrap" style={{ maxWidth: 1100 }}>
        <h1 style={{ fontSize: 22, marginBottom: 6 }}>Roadmap</h1>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Migrating from vanilla — coming soon on this branch.</p>
      </div>
    </div>
  );
}
