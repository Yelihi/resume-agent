import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App, createAppRouter } from "./App";
import { getAccount } from "./infrastructure/account/http";
import { ServerWorkspaceRepository } from "./infrastructure/workspace/ServerWorkspaceRepository";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
async function start() {
  root.render(<p role="status">계정과 저장소를 확인하고 있습니다.</p>);
  try {
    const account = await getAccount();
    if (account.mode !== "server" && account.mode !== "local") throw new Error("Invalid storage mode");
    root.render(<StrictMode><App router={createAppRouter()} store={account.mode === "server" ? new ServerWorkspaceRepository() : undefined} /></StrictMode>);
  } catch {
    root.render(<main><h1>서비스에 연결하지 못했습니다.</h1><p>로그인 상태와 서버 연결을 확인해 주세요.</p><button onClick={() => { void start(); }}>다시 연결</button></main>);
  }
}
void start();
