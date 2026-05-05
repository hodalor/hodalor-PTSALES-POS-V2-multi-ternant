import { useEffect } from 'react';
import { LANGUAGE_CHANGED_EVENT, translate } from '../utils/localization';
import { useLanguage } from './LanguageProvider';

const ORIGINAL_TEXT = Symbol('ptOriginalText');
const LAST_TEXT_OUTPUT = Symbol('ptLastTextOutput');
const ORIGINAL_ATTRS = Symbol('ptOriginalAttrs');
const LAST_ATTR_OUTPUTS = Symbol('ptLastAttrOutputs');

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
  const previousOutput = String(node[LAST_TEXT_OUTPUT] || '');
  if (!node[ORIGINAL_TEXT] || (current !== previousOutput && current !== node[ORIGINAL_TEXT])) {
    node[ORIGINAL_TEXT] = current;
  }
  const original = String(node[ORIGINAL_TEXT] || current);
  const translated = translate(language, String(original).trim());
  const nextValue = preserveSpacing(original, translated);
  node[LAST_TEXT_OUTPUT] = nextValue;
  if (node.nodeValue !== nextValue) {
    node.nodeValue = nextValue;
  }
}

function translateAttribute(element, attr, language) {
  if (!element?.hasAttribute?.(attr)) return;
  const attrs = element[ORIGINAL_ATTRS] || (element[ORIGINAL_ATTRS] = {});
  const outputs = element[LAST_ATTR_OUTPUTS] || (element[LAST_ATTR_OUTPUTS] = {});
  const current = element.getAttribute(attr) || '';
  if (!Object.prototype.hasOwnProperty.call(attrs, attr) || (current !== String(outputs[attr] || '') && current !== String(attrs[attr] || ''))) {
    attrs[attr] = current;
  }
  if (!Object.prototype.hasOwnProperty.call(attrs, attr)) {
    attrs[attr] = element.getAttribute(attr) || '';
  }
  const original = String(attrs[attr] || '');
  if (!original.trim()) return;
  const translated = translate(language, original.trim());
  const nextValue = preserveSpacing(original, translated);
  outputs[attr] = nextValue;
  if (element.getAttribute(attr) !== nextValue) {
    element.setAttribute(attr, nextValue);
  }
}

function translateInputValue(element, language) {
  if (!element || String(element.tagName || '').toUpperCase() !== 'INPUT') return;
  const type = String(element.getAttribute('type') || '').toLowerCase();
  if (!['button', 'submit', 'reset'].includes(type)) return;
  const attrs = element[ORIGINAL_ATTRS] || (element[ORIGINAL_ATTRS] = {});
  const outputs = element[LAST_ATTR_OUTPUTS] || (element[LAST_ATTR_OUTPUTS] = {});
  const current = element.getAttribute('value') || element.value || '';
  if (!Object.prototype.hasOwnProperty.call(attrs, 'value') || (current !== String(outputs.value || '') && current !== String(attrs.value || ''))) {
    attrs.value = current;
  }
  if (!Object.prototype.hasOwnProperty.call(attrs, 'value')) {
    attrs.value = element.getAttribute('value') || element.value || '';
  }
  const original = String(attrs.value || '');
  if (!original.trim()) return;
  const translated = translate(language, original.trim());
  const nextValue = preserveSpacing(original, translated);
  outputs.value = nextValue;
  if (element.value !== nextValue) element.value = nextValue;
  if (element.getAttribute('value') !== nextValue) element.setAttribute('value', nextValue);
}

function walkAndTranslate(root, language) {
  if (!root) return;
  
  // Translate all text nodes
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    translateTextNode(node, language);
    node = walker.nextNode();
  }
  
  // Translate all elements and their attributes
  const elements = root.querySelectorAll('*');
  elements.forEach((element) => {
    // Common translatable attributes
    translateAttribute(element, 'placeholder', language);
    translateAttribute(element, 'title', language);
    translateAttribute(element, 'aria-label', language);
    translateAttribute(element, 'alt', language);
    translateAttribute(element, 'aria-placeholder', language);
    translateAttribute(element, 'aria-description', language);
    translateAttribute(element, 'data-tooltip', language);
    
    // Button and input values
    translateInputValue(element, language);
    
    // Translate button text content if it's not already handled
    if (element.tagName === 'BUTTON' || element.tagName === 'A') {
      const textContent = element.textContent?.trim();
      if (textContent && !element.querySelector('*')) {
        const translated = translate(language, textContent);
        if (translated !== textContent) {
          element.textContent = translated;
        }
      }
    }
    
    // Translate common data attributes
    ['data-label', 'data-text', 'data-title', 'data-placeholder'].forEach(attr => {
      translateAttribute(element, attr, language);
    });
  });
}

function LocalizationRuntime() {
  const { language } = useLanguage();

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return undefined;
    try {
      document.documentElement.setAttribute('lang', language || 'en');
    } catch {}
    let frameId = 0;
    let timeoutIds = [];
    const run = () => {
      frameId = 0;
      walkAndTranslate(root, language);
    };
    const schedule = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(run);
    };
    
    // Immediate translation on language change
    const immediateTranslate = () => {
      run();
      // Double-check after a short delay to catch any late-rendered content
      timeoutIds.forEach((id) => window.clearTimeout(id));
      timeoutIds = [
        window.setTimeout(run, 100),
        window.setTimeout(run, 300)
      ];
    };
    
    // Listen for custom language change events
    const handleLanguageChange = () => {
      immediateTranslate();
    };
    
    schedule();
    immediateTranslate(); // Initial translation
    
    window.addEventListener(LANGUAGE_CHANGED_EVENT, handleLanguageChange);
    
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
      window.removeEventListener(LANGUAGE_CHANGED_EVENT, handleLanguageChange);
      observer.disconnect();
      if (frameId) window.cancelAnimationFrame(frameId);
      timeoutIds.forEach((id) => window.clearTimeout(id));
    };
  }, [language]);

  return null;
}

export default LocalizationRuntime;
