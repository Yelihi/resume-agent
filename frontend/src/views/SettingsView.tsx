import { useEffect, useState } from "react";
import type { Account, BackupStatus } from "../domain/shared/account";
import { OriginalDownload } from "../components/OriginalDownload";
import { useApplicationDependencies, useApplicationView } from "./context";

export function SettingsView() {
  const { services, confirm } = useApplicationDependencies();
  const { application, store } = useApplicationView();
  const { task } = application;
  const [account, setAccount] = useState<Account>();
  const [backup, setBackup] = useState<BackupStatus>();
  const [apiKey, setApiKey] = useState("");
  const [archive, setArchive] = useState<Blob>();
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void services.getAccount().then(async value => {
      if (active) setAccount(value);
      if (value.isOperator) { const status = await services.getBackupStatus(); if (active) setBackup(status); }
    }).catch(error => { if (active) task.reportError(error, "계정 상태를 불러오지 못했습니다."); });
    return () => { active = false; };
  }, [services, task.reportError]);
  const save = () => task.runTask(async () => {
    await services.saveOpenAiKey(apiKey.trim()); setApiKey("");
    setAccount(await services.getAccount()); setMessage("API 키를 저장했습니다.");
  }, "API 키를 저장하지 못했습니다.");
  const remove = () => {
    if (confirm("저장한 OpenAI API 키를 삭제할까요?")) void task.runTask(async () => {
      await services.deleteOpenAiKey(); setAccount(await services.getAccount()); setMessage("API 키를 삭제했습니다.");
    }, "API 키를 삭제하지 못했습니다.");
  };
  return <>
    <header className="topbar"><div><span className="eyebrow">ACCOUNT</span><h1>설정</h1><p>내 계정과 데이터 이관을 관리하세요.</p></div></header>
    <div className="library-page settings-page">
      <section className="library-card"><h2>OpenAI API 키</h2>
        {!account ? <p role="status">계정을 확인하고 있습니다.</p> : account.mode === "server" ? <>
          <p>{account.email} · <a href="/cdn-cgi/access/logout">로그아웃</a></p><p>{account.hasOpenAiKey ? `등록됨 · ${account.maskedOpenAiKey}` : "등록된 API 키가 없습니다."}</p>
          <form onSubmit={event => { event.preventDefault(); void save(); }}>
            <label>새 API 키<input type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} disabled={task.busy} /></label>
            <p>내 키로 AI 작업을 실행합니다. 저장한 키 원문은 다시 표시하지 않습니다.</p>
            <div className="card-actions"><button className="button-primary" disabled={task.busy || !apiKey.trim()}>키 저장</button><button type="button" className="button-secondary" disabled={task.busy || !account.hasOpenAiKey} onClick={remove}>키 삭제</button></div>
          </form>
        </> : <p>로컬 개발 모드입니다. API 키는 서버 실행 환경에서 설정합니다.</p>}
      </section>
      <section className="library-card"><h2>기존 데이터 이관</h2>
        {account?.mode === "local" ? <>
          <p>현재 브라우저에 저장한 이력서·자료·경험·검토를 파일로 내보냅니다. 원본과 개인정보가 포함됩니다.</p>
          <button className="button-secondary" disabled={task.busy} onClick={() => void task.runTask(async () => { setArchive(await services.exportWorkspace()); }, "데이터를 내보내지 못했습니다.")}>이관 파일 만들기</button>
          <OriginalDownload original={archive} name="resume-agent-workspace.json" />
        </> : account && <>
          <p>기존 브라우저에서 내보낸 파일을 내 계정으로 가져옵니다. 최초 이관은 비어 있는 계정에서 진행하며, 기존 브라우저의 데이터는 유지됩니다.</p>
          <label>이관 파일<input type="file" accept="application/json,.json" disabled={task.busy} onChange={event => {
            const file = event.target.files?.[0]; event.target.value = "";
            if (file && confirm("이 파일의 데이터를 현재 로그인한 계정으로 가져올까요?")) void task.runTask(async () => {
              await services.importWorkspace(file); await store.load(); setMessage("데이터를 가져왔습니다. 원본과 검토 이력을 확인해 주세요.");
            }, "데이터를 가져오지 못했습니다. 기존 데이터는 유지됩니다.");
          }} /></label>
        </>}
      </section>
      {account?.isOperator && <section className="library-card"><h2>백업 상태</h2>
        <p>마지막 성공: {backup?.lastSuccessAt ? new Date(backup.lastSuccessAt).toLocaleString("ko-KR") : "기록 없음"}</p>
        <p>마지막 시도: {backup?.lastAttemptAt ? new Date(backup.lastAttemptAt).toLocaleString("ko-KR") : "기록 없음"}</p>
        <p role="status">{!backup ? "백업 상태를 불러오고 있습니다." : backup.error === "BACKUP_NOT_RUN" ? "아직 백업 실행 기록이 없습니다." : backup.error ? "백업 또는 보관 정책 처리를 확인해 주세요." : "마지막 백업 처리가 완료됐습니다."}</p>
        <button className="button-secondary" disabled={task.busy} onClick={() => void task.runTask(async () => { setBackup(await services.getBackupStatus()); }, "백업 상태를 불러오지 못했습니다.")}>상태 새로고침</button>
      </section>}
      <p role="status">{message}</p>
    </div>
  </>;
}
