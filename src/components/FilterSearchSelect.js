import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppLanguage } from '../utils/localization';

function FilterSearchSelect({
  value = 'all',
  onChange,
  options = [],
  allLabel = 'All',
  searchPlaceholder = 'Type to search',
  disabled = false,
  className = ''
}) {
  const { t } = useAppLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const normalizedOptions = useMemo(() => {
    const rows = Array.isArray(options) ? options : [];
    const withAll = [{ value: 'all', label: allLabel }, ...rows];
    const seen = new Set();
    return withAll.filter((item) => {
      const key = String(item?.value ?? '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [allLabel, options]);
  const selectedLabel = useMemo(() => {
    const selected = normalizedOptions.find((item) => String(item.value) === String(value));
    return selected?.label || allLabel;
  }, [allLabel, normalizedOptions, value]);
  const filteredOptions = useMemo(() => {
    const term = String(query || '').trim().toLowerCase();
    if (!term) return normalizedOptions;
    return normalizedOptions.filter((item) => String(item.label || '').toLowerCase().includes(term));
  }, [normalizedOptions, query]);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery('');
      }
    }
    function handleEscape(event) {
      if (event.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(id);
  }, [open]);

  function handleSelect(nextValue) {
    onChange?.(nextValue);
    setOpen(false);
    setQuery('');
  }

  return (
    <div className={`filter-search-select ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className="filter-search-trigger"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open ? 'true' : 'false'}
        disabled={disabled}
      >
        <span className="filter-search-trigger-label">{selectedLabel}</span>
        <svg className={`filter-search-caret${open ? ' is-open' : ''}`} viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M5 7.5 10 12.5 15 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="filter-search-panel">
          <input
            ref={inputRef}
            className={`filter-search-input${query.trim() ? ' is-active' : ''}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(searchPlaceholder)}
          />
          <div className="filter-search-options" role="listbox">
            {filteredOptions.length === 0 ? (
              <div className="filter-search-empty">{t('No matching options')}</div>
            ) : (
              filteredOptions.map((item) => {
                const selected = String(item.value) === String(value);
                return (
                  <button
                    key={String(item.value)}
                    type="button"
                    className={`filter-search-option${selected ? ' is-selected' : ''}`}
                    onClick={() => handleSelect(item.value)}
                    role="option"
                    aria-selected={selected ? 'true' : 'false'}
                  >
                    {item.label}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default FilterSearchSelect;
