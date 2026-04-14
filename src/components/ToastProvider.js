import { createContext, useContext, useState, useCallback, useMemo } from 'react';

const ToastContext = createContext({ show: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

function ToastContainer({ toasts, remove }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type || 'info'}`} onClick={() => remove(t.id)}>
          <div className="toast-title">{t.title}</div>
          {t.message && <div className="toast-message">{t.message}</div>}
        </div>
      ))}
    </div>
  );
}

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const remove = useCallback((id) => setToasts(ts => ts.filter(t => t.id !== id)), []);
  const show = useCallback((title, opts = {}) => {
    const id = String(Date.now() + Math.random());
    const toast = { id, title, ...opts };
    setToasts(ts => [...ts, toast]);
    const timeout = opts.timeout ?? 3000;
    if (timeout > 0) {
      setTimeout(() => remove(id), timeout);
    }
  }, [remove]);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} remove={remove} />
    </ToastContext.Provider>
  );
}

export default ToastProvider;
