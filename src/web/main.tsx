import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <main>
      <h1>PeopleDesk</h1>
    </main>
  </StrictMode>,
);
