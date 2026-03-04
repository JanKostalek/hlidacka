"use client";

export default function AdminPopupLink() {
  return (
    <a
      className="adminIconLink"
      href="/admin"
      target="_blank"
      rel="noreferrer"
      aria-label="Otevrit administraci v nove zalozce"
      title="Administrace"
    >
      <img src="/admin.svg" alt="" width="64" height="64" />
    </a>
  );
}
