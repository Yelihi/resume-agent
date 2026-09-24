import { useState } from "react";

type FeedbackPanelProps = {
  initialFeedback: string;
  locked: boolean;
  hidden?: boolean;
  onSave: (feedback: string) => void;
};

export function FeedbackPanel({ initialFeedback, locked, hidden, onSave }: FeedbackPanelProps) {
  const [feedback, setFeedback] = useState(initialFeedback);
  return (
    <div className="feedback-panel" hidden={hidden}>
      <label>다음 검토에 반영할 의견
        <textarea aria-label="다음 검토에 반영할 의견" maxLength={2000} disabled={locked} value={feedback} onChange={event => setFeedback(event.target.value)} />
      </label>
      <p>문체·분량·강조할 내용을 작성해 주세요. 저장한 의견은 이 작업 공간의 다음 검토에 반영됩니다. (최대 2,000자)</p>
      <button disabled={locked} onClick={() => onSave(feedback)}>의견 저장</button>
    </div>
  );
}
