"use client";

export default function AdminPopupLink() {
  function openPopup(event) {
    event.preventDefault();
    window.open(
      "/admin",
      "hlidacka-admin",
      "popup=yes,width=1200,height=850,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes"
    );
  }

  return (
    <a className="adminIconLink" href="/admin" onClick={openPopup} aria-label="Otevrit administraci">
      <img src="/admin.svg" alt="" width="32" height="32" />
    </a>
  );
}
