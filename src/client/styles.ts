/**
 * Panel stylesheet, kept as a string so the browser bundle stays a single
 * `__ModuleLoader__` factory (the build does not process CSS files).
 *
 * Every colour comes from the Host's `--dsw-alias-*` tokens, so the panel
 * follows the current DSH theme (light or dark) without owning a theme of its
 * own. Sizes are in the same range the rest of the Web UI uses.
 *
 * @module
 */

/** Class names used by the panel. Injected once by the page. */
export const STYLES = `
.tf-root, .tf-root *, .tf-root *::before, .tf-root *::after { box-sizing: border-box; }
.tf-root {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 13px;
  line-height: 1.55;
}
.tf-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-width: thin; }
.tf-inner { width: 100%; max-width: 1080px; margin: 0 auto; padding: 0 24px; }
.tf-head { display: flex; align-items: flex-start; gap: 16px; padding: 20px 0 14px; }
.tf-head-main { min-width: 0; flex: 1 1 auto; }
.tf-title { margin: 0; font-size: 18px; font-weight: 650; letter-spacing: -0.01em; }
.tf-sub { margin: 3px 0 0; font-size: 12px; color: var(--dsw-alias-label-tertiary, inherit); }
.tf-head-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; padding-top: 2px; }
.tf-error {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-state-error-border, var(--dsw-alias-border-l2, transparent));
  background: var(--dsw-alias-state-error-bg, transparent);
  color: var(--dsw-alias-state-error-primary, inherit);
  font-size: 12px;
}
.tf-error-text { flex: 1 1 auto; min-width: 0; }
.tf-toolbar { display: flex; align-items: center; gap: 10px; padding-bottom: 14px; }
.tf-seg {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 10px;
  background: var(--dsw-alias-interactive-bg-hover, transparent);
  flex: 0 0 auto;
}
.tf-seg button {
  font: inherit;
  font-size: 12px;
  height: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  cursor: pointer;
  white-space: nowrap;
}
.tf-seg button:hover { color: var(--dsw-alias-label-primary, inherit); }
.tf-seg button[aria-selected='true'] {
  background: var(--dsw-alias-bg-layer-1, #fff);
  color: var(--dsw-alias-label-primary, inherit);
  box-shadow: 0 1px 2px var(--dsw-alias-bg-mask-1, rgba(0,0,0,.12));
  font-weight: 500;
}
.tf-count { font-size: 11px; color: var(--dsw-alias-label-caption, inherit); margin-left: 4px; font-variant-numeric: tabular-nums; }
.tf-grow { flex: 1 1 auto; min-width: 0; }
.tf-search, .tf-select {
  height: 28px;
  border: 1px solid var(--dsw-alias-border-l2, transparent);
  background: transparent;
  color: inherit;
  border-radius: 8px;
  font: inherit;
  font-size: 12px;
  padding: 0 9px;
  outline: none;
}
.tf-search { width: 210px; }
.tf-search::placeholder { color: var(--dsw-alias-label-caption, inherit); }
.tf-search:focus, .tf-select:focus { border-color: var(--dsw-alias-label-caption, transparent); }
.tf-select { max-width: 150px; cursor: pointer; }
.tf-select[data-invalid='true'] { border-color: var(--dsw-alias-state-error-primary, #ec1313); }

.tf-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
}
.tf-btn svg { width: 13px; height: 13px; }
.tf-btn-sm { height: 22px; padding: 0 8px; gap: 4px; border-radius: 7px; font-size: 11px; }
.tf-btn-sm svg { width: 11px; height: 11px; }
.tf-btn[data-tone='primary'] { background: var(--dsw-alias-button-primary-fill, #0f1115); color: #fff; }
.tf-btn[data-tone='primary']:hover { background: var(--dsw-alias-button-primary-hover, #43454a); }
body[data-ds-dark-theme] .tf-btn[data-tone='primary'] { color: #0f1115; }
.tf-btn[data-tone='soft'] { background: var(--dsw-alias-interactive-bg-hover, transparent); }
.tf-btn[data-tone='soft']:hover { background: var(--dsw-alias-interactive-bg-active, transparent); }
.tf-btn[data-tone='live'] {
  background: var(--dsw-alias-state-success-tertiary, transparent);
  color: var(--dsw-alias-state-success-primary, inherit);
}
.tf-btn[data-tone='live']:hover { background: var(--dsw-alias-state-success-secondary, transparent); color: #fff; }
.tf-btn[data-tone='ghost'] { border-color: var(--dsw-alias-border-l2, transparent); color: var(--dsw-alias-label-secondary, inherit); }
.tf-btn[data-tone='ghost']:hover { background: var(--dsw-alias-interactive-bg-hover, transparent); color: var(--dsw-alias-label-primary, inherit); }
.tf-btn:disabled { opacity: .45; cursor: default; }
.tf-btn:focus-visible, .tf-row:focus-visible, .tf-doc-row:focus-visible, .tf-seg button:focus-visible {
  outline: 2px solid var(--dsw-alias-link, #4176e6);
  outline-offset: 1px;
}

/* Split run button: main action plus the tier menu. The wrapper is inline-flex
   with the same height as .tf-btn, so a story row keeps its height whether or
   not the menu is open; the menu itself is out of flow. */
.tf-tier { position: relative; display: inline-flex; flex: 0 0 auto; }
.tf-tier-split {
  display: inline-flex;
  align-items: stretch;
  height: 26px;
  border-radius: 8px;
  overflow: hidden;
}
.tf-tier-split .tf-btn { height: 26px; border-radius: 0; }
.tf-tier-main { border-top-left-radius: 8px !important; border-bottom-left-radius: 8px !important; max-width: 190px; overflow: hidden; text-overflow: ellipsis; }
.tf-tier-arrow {
  width: 22px;
  min-width: 22px;
  padding: 0;
  justify-content: center;
  border-top-right-radius: 8px !important;
  border-bottom-right-radius: 8px !important;
}
.tf-tier-arrow svg { width: 10px; height: 10px; transition: transform .15s ease; }
.tf-tier[data-open='true'] .tf-tier-arrow svg { transform: rotate(180deg); }
.tf-tier-divider { width: 1px; align-self: stretch; margin: 5px 0; background: var(--dsw-alias-border-l2, rgba(0,0,0,.12)); }
@media (prefers-reduced-motion: reduce) {
  .tf-tier-arrow svg { transition: none; }
}
.tf-tier-menu {
  position: absolute;
  right: 0;
  z-index: 40;
  min-width: 244px;
  max-width: min(300px, calc(100vw - 24px));
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-3, #353638);
  border: 1px solid var(--dsw-alias-border-l3, transparent);
  box-shadow: 0 10px 28px var(--dsw-alias-bg-mask-1, rgba(0,0,0,.28));
  outline: none;
}
.tf-tier-menu[data-placement='down'] { top: calc(100% + 6px); }
.tf-tier-menu[data-placement='up'] { bottom: calc(100% + 6px); }
.tf-tier-item {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-primary, #fff);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.tf-tier-item[data-highlight='true'] { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); }
.tf-tier-item:focus-visible { outline: 2px solid var(--dsw-alias-link, #4176e6); outline-offset: -2px; }
.tf-tier-check { width: 12px; flex: 0 0 auto; font-size: 12px; line-height: 17px; color: var(--dsw-alias-link, #4176e6); }
.tf-tier-text { min-width: 0; }
.tf-tier-name { display: block; font-size: 12.5px; line-height: 17px; }
.tf-tier-desc { display: block; margin-top: 1px; font-size: 11.5px; line-height: 15px; color: var(--dsw-alias-label-tertiary, inherit); }
.tf-tier-error {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  width: max-content;
  max-width: min(280px, calc(100vw - 24px));
  padding: 6px 9px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3, #353638);
  border: 1px solid var(--dsw-alias-state-error-primary, #ec1313);
  color: var(--dsw-alias-label-primary, #fff);
  font-size: 11.5px;
  line-height: 15px;
  box-shadow: 0 8px 22px var(--dsw-alias-bg-mask-1, rgba(0,0,0,.24));
}
/* Read-only tier badge in the conversation header. */
.tf-tier-badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  border-radius: 6px;
  font-size: 11.5px;
  white-space: nowrap;
  border: 1px solid var(--dsw-alias-border-l2, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  cursor: default;
}
.tf-tier-badge[data-tier='readonly'] { border-color: var(--dsw-alias-state-warning-primary, #c98a00); }
.tf-tier-badge[data-tier='full'] { border-color: var(--dsw-alias-state-error-primary, #ec1313); }

.tf-group-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0 6px;
  font-size: 11.5px;
  color: var(--dsw-alias-label-caption, inherit);
  letter-spacing: .01em;
}
.tf-group { margin-bottom: 22px; }
.tf-list {
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.04));
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  overflow: hidden;
}
.tf-list > .tf-row + .tf-row-bug { width: 100%; text-align: left; background: none; border: 0; color: inherit; cursor: pointer; }
.tf-row-bug:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.04)); }
.tf-row-bug[data-state='running'] { box-shadow: inset 2px 0 0 var(--dsw-alias-state-success-primary, #22c55e); }
.tf-row { border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.04)); }
.tf-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px 10px 14px;
  border-radius: 0;
  border: 0;
  cursor: pointer;
  text-align: left;
  width: 100%;
  max-width: 100%;
  background: transparent;
  color: inherit;
  font: inherit;
}
.tf-row:hover { background: var(--dsw-alias-interactive-bg-hover, transparent); }
.tf-row[data-active='true']::before {
  content: '';
  position: absolute;
  left: 3px;
  top: 11px;
  bottom: 11px;
  width: 2px;
  border-radius: 2px;
  background: var(--dsw-alias-state-success-primary, #22c55e);
}
.tf-row-main { min-width: 0; flex: 1 1 auto; }
.tf-row-title {
  display: block;
  font-size: 13.5px;
  font-weight: 550;
  color: var(--dsw-alias-label-primary, inherit);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tf-row-meta {
  display: block;
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--dsw-alias-label-tertiary, inherit);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tf-sep { color: var(--dsw-alias-label-caption, inherit); margin: 0 6px; }
.tf-row-side { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
.tf-row-chevron { display: inline-flex; align-items: center; color: var(--dsw-alias-label-caption, inherit); margin-left: -2px; }
.tf-time { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, inherit); white-space: nowrap; min-width: 58px; text-align: right; }

.tf-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 500;
  padding: 1px 8px 1px 7px;
  border-radius: 999px;
  white-space: nowrap;
  flex: 0 0 auto;
}
.tf-state i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: 0 0 auto; }
.tf-state[data-state='running'] { color: var(--dsw-alias-state-success-primary, #22c55e); background: var(--dsw-alias-state-success-tertiary, rgba(34,197,94,.12)); }
.tf-state[data-state='ready'] { color: var(--dsw-alias-link, #4176e6); background: color-mix(in srgb, var(--dsw-alias-link, #4176e6) 10%, transparent); }
.tf-state[data-state='done'] { color: var(--dsw-alias-state-done-primary, #7c3aed); background: color-mix(in srgb, var(--dsw-alias-state-done-primary, #7c3aed) 12%, transparent); }
.tf-state[data-state='muted'] { color: var(--dsw-alias-label-caption, inherit); background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); }
.tf-kind {
  font-size: 11.5px;
  color: var(--dsw-alias-label-tertiary, inherit);
  border: 1px solid var(--dsw-alias-border-l2, transparent);
  border-radius: 6px;
  padding: 0 6px;
  white-space: nowrap;
  flex: 0 0 auto;
}
.tf-type {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: .02em;
  white-space: nowrap;
  flex: 0 0 auto;
}
.tf-type[data-kind='requirement'] {
  color: var(--dsw-alias-state-warn-primary, #d97706);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d97706) 12%, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d97706) 28%, transparent);
}
.tf-type[data-kind='design'] {
  color: var(--dsw-alias-link, #4176e6);
  background: color-mix(in srgb, var(--dsw-alias-link, #4176e6) 12%, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-link, #4176e6) 28%, transparent);
}
.tf-type[data-kind='story'] {
  color: var(--dsw-alias-state-done-primary, #7c3aed);
  background: color-mix(in srgb, var(--dsw-alias-state-done-primary, #7c3aed) 12%, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-state-done-primary, #7c3aed) 28%, transparent);
}
.tf-type[data-kind='bug'] {
  color: var(--dsw-alias-state-error-primary, #e5484d);
  background: var(--dsw-alias-state-error-bg, rgba(229, 72, 77, .12));
  border-color: var(--dsw-alias-state-error-border, transparent);
}

/* Navigation bar: outside the scroller, so the way back never scrolls away. */
.tf-navbar {
  flex: 0 0 auto;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .06));
  background: var(--dsw-alias-bg-layer-1, transparent);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 4%, transparent);
}
.tf-nav-inner { display: flex; align-items: center; gap: 10px; height: 52px; }
.tf-back {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  height: 30px;
  padding: 0 12px 0 8px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 13%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 5%, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background .12s ease, border-color .12s ease;
}
.tf-back:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 9%, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 22%, transparent);
}
.tf-back:active:not(:disabled) { transform: translateY(1px); }
.tf-back:disabled { opacity: .5; cursor: default; }
.tf-back svg { width: 14px; height: 14px; stroke-width: 1.7; }
.tf-nav-rule { flex: 0 0 auto; width: 1px; height: 18px; background: var(--dsw-alias-border-l2, rgba(0, 0, 0, .12)); }
.tf-crumbs { display: flex; align-items: center; gap: 2px; min-width: 0; margin: 0; padding: 0; list-style: none; }
.tf-crumb-item { display: flex; align-items: center; min-width: 0; }
.tf-crumb-sep { display: inline-flex; align-items: center; flex: 0 0 auto; color: var(--dsw-alias-label-caption, inherit); opacity: .75; }
.tf-crumb-sep svg { width: 11px; height: 11px; }
.tf-crumb-link,
.tf-crumb-plain {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 26ch;
  padding: 3px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: inherit;
  font-size: 12.5px;
}
.tf-crumb-link { cursor: pointer; }
.tf-crumb-link:hover { color: var(--dsw-alias-label-primary, inherit); background: var(--dsw-alias-interactive-bg-hover, transparent); }
.tf-crumb-link svg,
.tf-crumb-plain svg { width: 13px; height: 13px; flex: 0 0 auto; }
.tf-crumb-plain { color: var(--dsw-alias-label-tertiary, inherit); }
.tf-crumb-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tf-crumb-current {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 52ch;
  padding: 3px 9px 3px 5px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--dsw-alias-link, #4176e6) 9%, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 12.5px;
  font-weight: 600;
}
.tf-crumb-kind {
  flex: 0 0 auto;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-link, #4176e6) 14%, transparent);
  color: var(--dsw-alias-link, #4176e6);
  font-size: 10.5px;
  font-weight: 650;
  line-height: 17px;
  letter-spacing: .02em;
}
.tf-back:focus-visible,
.tf-crumb-link:focus-visible { outline: 2px solid var(--dsw-alias-link, #4176e6); outline-offset: 2px; }
.tf-detail-head { display: flex; align-items: flex-start; gap: 16px; padding: 18px 0 14px; }
.tf-detail-heading { min-width: 0; flex: 1 1 auto; }
.tf-detail-title { margin: 0; font-size: 19px; font-weight: 650; letter-spacing: -0.01em; line-height: 1.35; }
.tf-pills { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.tf-grid { display: grid; grid-template-columns: minmax(0, 1fr) 292px; gap: 16px; align-items: start; padding-bottom: 28px; }
.tf-card {
  border: 1px solid var(--dsw-alias-border-l2, transparent);
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  padding: 13px 16px 14px;
}
.tf-card + .tf-card { margin-top: 12px; }
.tf-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
.tf-card-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary, inherit); }
.tf-section-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0 0 10px;
  padding-bottom: 7px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .06));
}
.tf-section-title {
  position: relative;
  display: inline-block;
  padding-left: 9px;
  font-size: 14px;
  font-weight: 650;
  letter-spacing: -0.005em;
  color: var(--dsw-alias-label-primary, inherit);
}
.tf-section-title::before {
  content: '';
  position: absolute;
  left: 0;
  top: 2px;
  bottom: 2px;
  width: 3px;
  border-radius: 2px;
  background: var(--dsw-alias-link, #4176e6);
}
.tf-section-hint { margin-left: auto; font-size: 11.5px; font-weight: 400; color: var(--dsw-alias-label-caption, inherit); }
.tf-section-action { display: inline-flex; align-items: center; flex: 0 0 auto; margin-left: auto; }
.tf-section-hint + .tf-section-action { margin-left: 0; }
.tf-card-hint { font-size: 11.5px; color: var(--dsw-alias-label-caption, inherit); }
.tf-bullets { margin: 0; padding: 0; list-style: none; }
.tf-bullets li { position: relative; padding-left: 14px; margin: 3px 0; font-size: 12.5px; color: var(--dsw-alias-label-secondary, inherit); }
.tf-bullets li::before { content: '·'; position: absolute; left: 3px; color: var(--dsw-alias-label-caption, inherit); }

.tf-doc-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 8px;
  margin: 0 -4px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.tf-doc-row:hover { background: var(--dsw-alias-interactive-bg-hover, transparent); }
.tf-doc-kind {
  font-size: 11px;
  border-radius: 6px;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l2, transparent);
  color: var(--dsw-alias-label-tertiary, inherit);
  white-space: nowrap;
  flex: 0 0 auto;
}
.tf-doc-title { font-size: 13px; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tf-doc-meta { font-size: 11.5px; color: var(--dsw-alias-label-caption, inherit); white-space: nowrap; flex: 0 0 auto; }
.tf-chevron { color: var(--dsw-alias-label-caption, inherit); display: inline-flex; }
.tf-chevron svg { width: 14px; height: 14px; }

.tf-story { display: flex; align-items: center; gap: 10px; padding: 7px 8px; margin: 0 -4px; border-radius: 10px; cursor: pointer; scroll-margin-block: 96px; }
.tf-story:hover { background: var(--dsw-alias-interactive-bg-hover, transparent); }
#tf-section-design, #tf-section-docs, #tf-section-stories { scroll-margin-top: 14px; }
.tf-story-main { min-width: 0; flex: 1 1 auto; }
.tf-story-title { display: block; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tf-story-meta { display: block; font-size: 11.5px; color: var(--dsw-alias-label-tertiary, inherit); margin-top: 1px; }
.tf-story-detail { margin: 2px 0 8px 28px; padding-left: 12px; border-left: 1px solid var(--dsw-alias-border-l2, transparent); }
.tf-story-detail .tf-card-hint { display: block; margin-top: 6px; }

.tf-bug { display: flex; align-items: center; gap: 10px; width: 100%; padding: 5px 0; font-size: 12.5px; text-align: left; background: none; border: 0; color: inherit; cursor: pointer; }
.tf-bug:hover .tf-bug-title { text-decoration: underline; text-underline-offset: 3px; }
.tf-bug > svg { flex: 0 0 auto; color: var(--dsw-alias-label-caption, #adb2b8); }
.tf-bug-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tf-bug-status { font-size: 11.5px; color: var(--dsw-alias-label-caption, inherit); }

.tf-run { display: flex; align-items: baseline; gap: 9px; padding: 5px 0; font-size: 12.5px; }
.tf-run-dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; transform: translateY(-2px); }
.tf-run-dot[data-state='running'] { background: var(--dsw-alias-state-success-primary, #22c55e); }
.tf-run-dot[data-state='done'] { background: var(--dsw-alias-state-done-primary, #7c3aed); }
.tf-run-main { min-width: 0; flex: 1 1 auto; }
.tf-run-title { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tf-run-meta { font-size: 11.5px; color: var(--dsw-alias-label-caption, inherit); font-variant-numeric: tabular-nums; }
.tf-id {
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
  font-size: 10px;
  letter-spacing: -0.2px;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary, inherit);
}

.tf-kv { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 6px 12px; font-size: 12.5px; }
.tf-kv dt { color: var(--dsw-alias-label-tertiary, inherit); }
.tf-kv dd { margin: 0; text-align: right; color: var(--dsw-alias-label-primary, inherit); overflow-wrap: anywhere; }
.tf-kv-session { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
.tf-kv-session button {
  max-width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: var(--dsw-alias-link, #4176e6);
  font-family: inherit;
  font-size: 11.5px;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.tf-kv-session button:hover { text-decoration: underline; }
.tf-session-card { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.tf-session-id { font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace; font-size: 11.5px; color: var(--dsw-alias-label-secondary, inherit); }
.tf-session-title { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--dsw-alias-label-primary, inherit); }

.tf-session-list { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.tf-session-item { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2, transparent); }
.tf-session-item[data-latest='true'] { border: 1px solid var(--dsw-alias-border-l2, transparent); }
.tf-session-main { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 1px; }
.tf-session-label { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-tertiary, inherit); }
.tf-session-main .tf-session-id { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tf-session-meta { font-size: 11px; color: var(--dsw-alias-label-caption, inherit); }
.tf-session-toggle { display: inline-flex; align-items: center; gap: 5px; margin-top: 10px; padding: 0; border: 0; background: none; color: var(--dsw-alias-label-secondary, inherit); font: inherit; font-size: 11.5px; cursor: pointer; }
.tf-session-toggle:hover { color: var(--dsw-alias-label-primary, inherit); }
.tf-session-toggle svg { width: 13px; height: 13px; }
.tf-session-history { padding-left: 10px; border-left: 1px solid var(--dsw-alias-border-l2, transparent); }
.tf-sessions { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l1, transparent); }
.tf-sessions-head { display: flex; align-items: baseline; gap: 7px; }
.tf-sessions-title { font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-secondary, inherit); }
.tf-sessions-count {
  padding: 0 5px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2, transparent);
  font-size: 10.5px;
  color: var(--dsw-alias-label-caption, inherit);
}
.tf-sessions .tf-session-list { margin-top: 7px; }

.tf-empty { display: grid; place-items: center; gap: 6px; padding: 64px 0 32px; text-align: center; }
.tf-empty-title { font-size: 13.5px; font-weight: 500; }
.tf-empty-body { font-size: 12px; color: var(--dsw-alias-label-tertiary, inherit); }
.tf-empty button { margin-top: 6px; }

.tf-doc-body { max-width: 760px; padding-bottom: 32px; }
.tf-doc-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 236px;
  gap: 24px;
  align-items: start;
  padding-bottom: 28px;
}
.tf-doc-aside { position: sticky; top: 0; }
.tf-tree { display: flex; flex-direction: column; gap: 1px; margin: 0 -4px; }
.tf-tree-dir {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  font-size: 11.5px;
  color: var(--dsw-alias-label-tertiary, inherit);
}
.tf-tree-dir svg { width: 13px; height: 13px; flex: 0 0 auto; color: var(--dsw-alias-label-caption, inherit); }
.tf-tree-file {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 5px 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.tf-tree-file:hover { background: var(--dsw-alias-interactive-bg-hover, transparent); }
.tf-tree-file[data-active='true'] {
  background: color-mix(in srgb, var(--dsw-alias-link, #4176e6) 10%, transparent);
  color: var(--dsw-alias-link, #4176e6);
}
.tf-tree-file svg { width: 13px; height: 13px; flex: 0 0 auto; color: var(--dsw-alias-label-caption, inherit); }
.tf-tree-file[data-active='true'] svg { color: currentColor; }
.tf-tree-name { min-width: 0; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tf-tree-note {
  margin-left: auto;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
  font-size: 10.5px;
  color: var(--dsw-alias-label-caption, inherit);
  white-space: nowrap;
}

.tf-toast {
  position: absolute;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(520px, calc(100% - 48px));
  padding: 7px 14px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-3, #353638);
  color: var(--dsw-alias-label-primary, #fff);
  border: 1px solid var(--dsw-alias-border-l3, transparent);
  box-shadow: 0 6px 20px var(--dsw-alias-bg-mask-1, rgba(0,0,0,.2));
  font-size: 12px;
  z-index: 20;
}
.tf-toast svg { width: 13px; height: 13px; flex: 0 0 auto; color: var(--dsw-alias-link, #4176e6); }

.tf-modal-mask {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: var(--dsw-alias-bg-mask-1, rgba(0,0,0,.24));
  z-index: 30;
  padding: 24px;
}
.tf-modal {
  width: min(430px, 100%);
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-1, #fff);
  border: 1px solid var(--dsw-alias-border-l2, transparent);
  box-shadow: 0 18px 48px var(--dsw-alias-bg-mask-1, rgba(0,0,0,.28));
  padding: 18px 18px 14px;
}
.tf-modal-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 12%, transparent);
  color: var(--dsw-alias-state-error-primary, #ec1313);
}
.tf-modal-icon svg { width: 15px; height: 15px; }
.tf-modal h2 { margin: 10px 0 6px; font-size: 14.5px; font-weight: 600; }
.tf-modal p { margin: 0 0 12px; font-size: 12.5px; color: var(--dsw-alias-label-secondary, inherit); }
.tf-modal-foot { display: flex; justify-content: flex-end; gap: 8px; }
.tf-root { position: relative; }

.tf-check {
  width: 14px;
  height: 14px;
  margin: 0 2px 0 0;
  flex: 0 0 auto;
  accent-color: var(--dsw-alias-state-error-primary, #ec1313);
  cursor: pointer;
}
.tf-danger { color: var(--dsw-alias-state-error-primary, #ec1313); }
.tf-danger:hover { background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 10%, transparent); }
.tf-danger-fill,
.tf-danger-fill:hover {
  background: var(--dsw-alias-state-error-primary, #ec1313) !important;
  color: #fff !important;
}
.tf-danger-text { color: var(--dsw-alias-state-error-primary, #ec1313); }
.tf-cleanup {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 12px;
  margin: 0 0 12px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 28%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 6%, transparent);
  font-size: 12px;
}
.tf-cleanup-count { font-weight: 600; }
.tf-modal-wide {
  width: min(560px, 100%);
  max-height: min(78vh, 640px);
  overflow: auto;
}
.tf-delete-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, inherit);
}
.tf-delete-list {
  list-style: none;
  margin: 0 0 10px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tf-delete-list li {
  padding: 7px 10px;
  border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06));
  background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.02));
}
.tf-delete-list li[data-state='blocked'] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 34%, transparent);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 6%, transparent);
}
.tf-delete-list li[data-state='cascade'] { border-style: dashed; }
.tf-delete-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12.5px;
}
.tf-delete-line > span:nth-child(3) {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tf-delete-state {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary, inherit);
}
.tf-delete-reason {
  display: block;
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--dsw-alias-state-error-primary, #ec1313);
}
.tf-delete-docs { margin-top: 4px; }

@media (max-width: 980px) {
  .tf-grid { grid-template-columns: minmax(0, 1fr); }
  .tf-doc-layout { grid-template-columns: minmax(0, 1fr); }
  .tf-doc-aside { position: static; }
  .tf-inner { padding: 0 16px; }
}
@media (max-width: 720px) {
  .tf-search { width: 140px; }
  .tf-row { flex-wrap: wrap; }
  .tf-time { display: none; }
  .tf-kind { display: none; }
}
.tf-create { padding-bottom: 28px; }
.tf-create-form { display: flex; flex-direction: column; gap: 12px; max-width: 760px; }
.tf-create-form .tf-card + .tf-card { margin-top: 0; }
.tf-kind-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
.tf-kind-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2, transparent);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.tf-kind-option:hover { background: var(--dsw-alias-interactive-bg-hover, transparent); }
.tf-kind-option[data-active='true'] {
  border-color: var(--dsw-alias-label-primary, currentColor);
  background: var(--dsw-alias-interactive-bg-hover, transparent);
}
.tf-kind-name { font-size: 13px; font-weight: 600; }
.tf-kind-hint { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, inherit); line-height: 1.45; }
.tf-field { display: flex; flex-direction: column; gap: 6px; }
.tf-field + .tf-field { margin-top: 12px; }
.tf-field-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary, inherit);
}
.tf-field-hint { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary, inherit); }
/*
 * Required marker of a form field. It is a badge rather than a bare asterisk
 * because the Create page explains in words that the field must be chosen by
 * hand; the marker keeps that rule visible next to the label.
 */
.tf-required-badge {
  display: inline-flex;
  align-items: center;
  height: 16px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--dsw-alias-state-error-tertiary, rgba(236, 19, 19, .12));
  color: var(--dsw-alias-state-error-primary, #ec1313);
  font-size: 10.5px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}
/*
 * Workspace combobox on the Create page. Deliberately larger and more
 * prominent than the toolbar selects (.tf-select, 28px/12px): the user must
 * touch it on every create, so it keeps the form-control geometry (.tf-input)
 * — 10px radius, 14px text, opaque surface, inset ring — plus a 44px hit area
 * and a 2px ring. Geometry never changes on hover, focus or selection: only
 * the ring colour and the text weight do, so the control cannot jitter and the
 * card keeps its height. The field, the popup and the quick-pick row are all
 * 100% of the column, so the narrow layout stays inside the card.
 */
.tf-workspace-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.tf-workspace-picker {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  height: 44px;
  padding: 0 6px 0 12px;
  border-radius: 10px;
  corner-shape: round;
  background-color: var(--dsw-alias-bg-layer-1, #fff);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));
  transition: box-shadow .12s ease, background-color .12s ease;
}
/* Placeholder: muted text, thin ring. Chosen: primary text, bolder, 2px ring. */
.tf-workspace-picker[data-state='selected'] {
  box-shadow: inset 0 0 0 2px var(--dsw-alias-label-secondary, rgba(0, 0, 0, .3));
}
.tf-workspace-picker:hover:not([data-open='true']):not([data-disabled='true']) {
  box-shadow: inset 0 0 0 2px var(--dsw-alias-border-l4, rgba(0, 0, 0, .16));
}
.tf-workspace-picker[data-open='true'],
.tf-workspace-picker:focus-within {
  box-shadow: inset 0 0 0 2px var(--dsw-alias-state-business-primary, #4176e6);
}
/* The ring alone is subtle at 2px, so keyboard focus adds an outer outline. */
.tf-workspace-picker:has(.tf-workspace-input:focus-visible) {
  outline: 2px solid var(--dsw-alias-link, #4176e6);
  outline-offset: 2px;
}
.tf-workspace-picker[data-invalid='true'],
.tf-workspace-picker[data-invalid='true']:focus-within {
  box-shadow: inset 0 0 0 2px var(--dsw-alias-state-error-primary, #ec1313);
}
.tf-workspace-picker[data-disabled='true'] {
  background-color: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 4%, var(--dsw-alias-bg-layer-1, #fff));
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));
  cursor: not-allowed;
}
.tf-workspace-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  line-height: 22px;
  text-overflow: ellipsis;
  outline: none;
}
.tf-workspace-picker[data-state='placeholder'] .tf-workspace-input {
  color: var(--dsw-alias-label-tertiary, #81858c);
  font-weight: 500;
}
.tf-workspace-input::placeholder {
  color: var(--dsw-alias-label-tertiary, #81858c);
  font-weight: 500;
  opacity: 1;
}
.tf-workspace-input:disabled { cursor: not-allowed; }
.tf-workspace-toggle {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #81858c);
  cursor: pointer;
}
.tf-workspace-toggle:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05));
  color: var(--dsw-alias-label-primary, inherit);
}
.tf-workspace-toggle:disabled { cursor: not-allowed; }
.tf-workspace-toggle svg { transition: transform .12s ease; }
.tf-workspace-picker[data-open='true'] .tf-workspace-toggle svg { transform: rotate(180deg); }
/*
 * Filter popup. It is absolutely positioned inside the field so it overlays the
 * description instead of pushing the form, and it shares the field's width so
 * a narrow window never expands the card horizontally.
 */
.tf-workspace-popup {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 6px);
  z-index: 40;
  box-sizing: border-box;
  max-height: 280px;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  list-style: none;
  border-radius: 12px;
  corner-shape: round;
  background: var(--dsw-alias-bg-layer-1, #fff);
  box-shadow: 0 10px 28px rgba(15, 17, 21, .16), 0 0 0 1px var(--dsw-alias-border-l2, rgba(0, 0, 0, .08));
}
.tf-workspace-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 8px;
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 13.5px;
  line-height: 20px;
  cursor: pointer;
}
.tf-workspace-option[data-active='true'] { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05)); }
.tf-workspace-option[aria-selected='true'] { font-weight: 600; }
.tf-workspace-option-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tf-workspace-check { flex: 0 0 auto; color: var(--dsw-alias-state-business-primary, #4176e6); font-size: 12px; }
.tf-workspace-empty {
  padding: 10px;
  color: var(--dsw-alias-label-tertiary, #81858c);
  font-size: 12.5px;
  line-height: 18px;
}
/*
 * Quick picks: one click reuses a workspace without pre-selecting it. The row
 * wraps, so long titles and a narrow window shorten the chips instead of the
 * layout.
 */
.tf-quick { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.tf-quick-title {
  flex: 0 0 auto;
  color: var(--dsw-alias-label-tertiary, #81858c);
  font-size: 11.5px;
  line-height: 16px;
}
.tf-quick-list { display: flex; flex: 1 1 auto; flex-wrap: wrap; gap: 6px; min-width: 0; }
.tf-quick-chip {
  max-width: 100%;
  padding: 3px 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.tf-quick-chip:hover:not(:disabled) {
  border-color: var(--dsw-alias-border-l4, rgba(0, 0, 0, .16));
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .04));
  color: var(--dsw-alias-label-primary, inherit);
}
.tf-quick-chip[data-active='true'] {
  border-color: var(--dsw-alias-state-business-primary, #4176e6);
  color: var(--dsw-alias-state-business-primary, #4176e6);
  font-weight: 600;
}
.tf-quick-chip:focus-visible {
  outline: 2px solid var(--dsw-alias-link, #4176e6);
  outline-offset: 2px;
}
.tf-quick-chip:disabled { color: var(--dsw-alias-label-caption, #adb2b8); cursor: not-allowed; }
/*
 * Form controls (create page only: .tf-textarea lives in create.tsx, .tf-input has no
 * other caller). Four properties of the previous version made the 1px ring shimmer
 * while the native text control repainted; the story delivery notes carry the
 * measurements behind each one:
 *   1. the ring was a CSS border. Chrome repaints a border ring as its own 1px quad,
 *      and on a scrollable native control with a radius that quad could be re-rastered
 *      out of phase with the text layer, so the ring flashed dark on the top/left
 *      edge. The ring is now an inset box-shadow, i.e. part of the element's own
 *      background paint, and never a separate quad.
 *   2. the box was 205.171875px tall (13px x 1.6 = 20.8px line-height x 9 rows), so
 *      every edge landed on a fractional device pixel and each repaint could round
 *      differently. font-size/line-height/padding are integers now, which makes the
 *      whole control land on whole device pixels.
 *   3. background was transparent, so the translucent ring token was re-blended over
 *      the card on every repaint. The surface is opaque now.
 *   4. the Host globals pin corner-shape: superellipse(1.5) on every element; a
 *      squircle clip re-derives the edge coverage each paint. round restores a plain
 *      radius for this control.
 * Focus only recolours the ring: no geometry, padding or border width changes, and
 * nothing is painted outside the control, so focus/blur cannot jitter the layout.
 */
.tf-input, .tf-textarea {
  width: 100%;
  box-sizing: border-box;
  border: 0;
  border-radius: 10px;
  corner-shape: round;
  background-color: var(--dsw-alias-bg-layer-1, #fff);
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 14px;
  line-height: 22px;
  padding: 10px 12px;
  outline: none;
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l3, rgba(0, 0, 0, .12));
  transition: box-shadow .12s ease, background-color .12s ease;
}
.tf-input { height: 34px; padding-top: 0; padding-bottom: 0; }
.tf-textarea { min-height: 150px; resize: vertical; scrollbar-gutter: stable; }
.tf-input::placeholder, .tf-textarea::placeholder { color: var(--dsw-alias-label-tertiary, #81858c); opacity: 1; }
.tf-input:hover:not(:focus):not(:disabled),
.tf-textarea:hover:not(:focus):not(:disabled) {
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l4, rgba(0, 0, 0, .16));
}
.tf-input:focus, .tf-textarea:focus {
  box-shadow: inset 0 0 0 1px var(--dsw-alias-state-business-primary, #4176e6);
}
.tf-input[data-invalid='true'], .tf-textarea[data-invalid='true'],
.tf-input[data-invalid='true']:focus, .tf-textarea[data-invalid='true']:focus {
  box-shadow: inset 0 0 0 1px var(--dsw-alias-state-error-primary, #ec1313);
}
.tf-input:disabled, .tf-textarea:disabled {
  background-color: color-mix(in srgb, var(--dsw-alias-label-primary, #0f1115) 4%, var(--dsw-alias-bg-layer-1, #fff));
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));
  color: var(--dsw-alias-label-caption, #adb2b8);
  cursor: not-allowed;
}
.tf-create-actions { display: flex; align-items: center; gap: 10px; padding-top: 2px; }
/*
 * Attachment block. The picker is the Host's own file input, so it keeps the
 * Host rules for what can be selected; it is only hidden because the visible
 * control is the card's button and native inputs cannot be styled consistently.
 */
.tf-attachment-bar { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.tf-attachment-input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
.tf-attachment-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tf-attachment-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 210px;
  max-width: 100%;
  padding: 6px 8px;
  border-radius: 10px;
  background: var(--dsw-alias-interactive-bg-hover, transparent);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2, transparent);
  font-size: 12.5px;
}
.tf-attachment-item[data-state='failed'] {
  background: var(--dsw-alias-state-error-bg, transparent);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-state-error-border, transparent);
}
.tf-attachment-thumb {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: var(--dsw-alias-bg-l2, rgba(127, 127, 127, .12));
  color: var(--dsw-alias-label-secondary, inherit);
}
.tf-attachment-thumb-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.tf-attachment-ext { font-size: 10px; font-weight: 600; letter-spacing: .02em; }
.tf-attachment-body { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px; padding-right: 14px; }
.tf-attachment-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary, inherit);
}
.tf-attachment-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--dsw-alias-label-tertiary, inherit);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
}
.tf-attachment-sep { opacity: .6; }
.tf-attachment-item[data-state='failed'] .tf-attachment-status { color: var(--dsw-alias-state-error-primary, inherit); }
.tf-attachment-remove {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, inherit);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  opacity: .75;
}
.tf-attachment-remove:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-active, transparent); color: var(--dsw-alias-label-primary, inherit); opacity: 1; }
.tf-attachment-remove:disabled { opacity: .3; cursor: default; }
.tf-attachment-track {
  margin-top: 3px;
  height: 3px;
  border-radius: 2px;
  background: var(--dsw-alias-border-l2, transparent);
  overflow: hidden;
}
.tf-attachment-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--dsw-alias-state-business-primary, #4176e6);
  transition: width .15s linear;
}
.tf-attachment-error {
  color: var(--dsw-alias-state-error-primary, inherit);
  font-size: 11px;
  line-height: 1.4;
}
.tf-attachment-rejected {
  list-style: none;
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 9px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--dsw-alias-state-error-primary, inherit);
  background: var(--dsw-alias-state-error-bg, transparent);
}
@media (max-width: 720px) {
  .tf-kind-grid { grid-template-columns: minmax(0, 1fr); }
}

@media (prefers-reduced-motion: reduce) {
  .tf-root * { transition: none !important; animation: none !important; }
}
`

/** Styles for the conversation-side tab; rendered by the tab because the panel may never mount. */
export const SESSION_STYLES = `
.tf-tab { min-height: 0; }
.tf-tab-bar {
  flex: 0 0 auto;
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 24px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .06));
  background: var(--dsw-alias-bg-layer-1, transparent);
}
.tf-tab-crumb {
  min-width: 0;
  max-width: 40%;
  font-size: 12px;
  color: var(--dsw-alias-label-primary, inherit);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tf-tab-crumb-sub { color: var(--dsw-alias-label-tertiary, inherit); }
.tf-tab-readonly {
  flex: 0 0 auto;
  padding: 0 7px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, inherit);
  background: var(--dsw-alias-interactive-bg-hover, transparent);
}
.tf-tab-back { flex: 0 0 auto; }
.tf-tab-banner { margin: 8px 24px 0; }
.tf-tab-state {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
}
.tf-tab-state-inner {
  display: grid;
  justify-items: center;
  gap: 6px;
  max-width: 520px;
  text-align: center;
}
.tf-tab-state-title { font-size: 13.5px; font-weight: 500; }
.tf-tab-state-body { font-size: 12px; color: var(--dsw-alias-label-tertiary, inherit); }
.tf-tab-state-inner .tf-btn { margin-top: 8px; }
@media (max-width: 720px) {
  .tf-tab-bar { padding: 8px 16px; }
  .tf-tab-readonly { display: none; }
}
`

/** Composer cell styles; rendered with the cell because the panel may be closed. */
export const COMPOSER_STYLES = `
.tf-composer { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; }
.tf-composer-field { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
.tf-composer-label { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, inherit); white-space: nowrap; }
.tf-composer-select {
  height: 24px;
  max-width: 132px;
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-l2, transparent);
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, inherit);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
  outline: none;
}
.tf-composer-select:focus { border-color: var(--dsw-alias-label-caption, transparent); }
.tf-composer-select:disabled { opacity: .55; cursor: default; }
.tf-composer-note {
  font-size: 11px;
  color: var(--dsw-alias-label-caption, inherit);
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`
