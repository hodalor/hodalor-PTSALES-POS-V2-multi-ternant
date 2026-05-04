import { useEffect } from 'react';
import { translate, useAppLanguage } from '../utils/localization';

const ORIGINAL_TEXT = Symbol('ptOriginalText');
const ORIGINAL_ATTRS = Symbol('ptOriginalAttrs');

function shouldSkipTextNode(node) {
  const parent = node?.parentElement;
  if (!parent) return true;
  if (parent.closest('[data-no-localize="true"]')) return true;
  if (parent.closest('[contenteditable="true"]')) return true;
  const tag = String(parent.tagName || '').toUpperCase();
  return ['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE'].includes(tag);
}

function preserveSpacing(original, translated) {
  const source = String(original || '');
  const leading = source.match(/^\s*/)?.[0] || '';
  const trailing = source.match(/\s*$/)?.[0] || '';
  return `${leading}${translated}${trailing}`;
}

function translateTextNode(node, language) {
  if (!node || shouldSkipTextNode(node)) return;
  const current = String(node.nodeValue || '');
  if (!current.trim()) return;
  const original = node[ORIGINAL_TEXT] ?? current;
  if (!node[ORIGINAL_TEXT]) node[ORIGINAL_TEXT] = original;
  const translated = translate(language, String(original).trim());
  const nextValue = preserveSpacing(original, translated);
  if (node.nodeValue !== nextValue) {
    node.nodeValue = nextValue;
  }
}

function translateAttribute(element, attr, language) {
  if (!element?.hasAttribute?.(attr)) return;
  const attrs = element[ORIGINAL_ATTRS] || (element[ORIGINAL_ATTRS] = {});
  if (!Object.prototype.hasOwnProperty.call(attrs, attr)) {
    attrs[attr] = element.getAttribute(attr) || '';
  }
  const original = String(attrs[attr] || '');
  if (!original.trim()) return;
  const translated = translate(language, original.trim());
  const nextValue = preserveSpacing(original, translated);
  if (element.getAttribute(attr) !== nextValue) {
    element.setAttribute(attr, nextValue);
  }
}

function translateInputValue(element, language) {
  if (!element || String(element.tagName || '').toUpperCase() !== 'INPUT') return;
  const type = String(element.getAttribute('type') || '').toLowerCase();
  if (!['button', 'submit', 'reset'].includes(type)) return;
  const attrs = element[ORIGINAL_ATTRS] || (element[ORIGINAL_ATTRS] = {});
  if (!Object.prototype.hasOwnProperty.call(attrs, 'value')) {
    attrs.value = element.getAttribute('value') || element.value || '';
  }
  const original = String(attrs.value || '');
  if (!original.trim()) return;
  const translated = translate(language, original.trim());
  const nextValue = preserveSpacing(original, translated);
  if (element.value !== nextValue) element.value = nextValue;
  if (element.getAttribute('value') !== nextValue) element.setAttribute('value', nextValue);
}

function walkAndTranslate(root, language) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    translateTextNode(node, language);
    node = walker.nextNode();
  }
  const elements = root.querySelectorAll('*');
  elements.forEach((element) => {
    translateAttribute(element, 'placeholder', language);
    translateAttribute(element, 'title', language);
    translateAttribute(element, 'aria-label', language);
    translateAttribute(element, 'alt', language);
    translateInputValue(element, language);
  });
}

function LocalizationRuntime() {
  const { language } = useAppLanguage();

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;
    try {
      document.documentElement.setAttribute('lang', language || 'en');
    } catch {}
    let frameId = 0;
    const run = () => {
      frameId = 0;
      walkAndTranslate(root, language);
    };
    const schedule = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(run);
    };
    schedule();
    const observer = new MutationObserver(() => {
      schedule();
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label', 'value']
    });
    return () => {
      observer.disconnect();
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, [language]);

  return null;
}

export default LocalizationRuntime;
