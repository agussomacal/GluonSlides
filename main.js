// ============================================================
// main.js — Entry module. Wires index.html controls to their
// handlers and starts the app. Logic lives in:
//   ui/project.js         project lifecycle, recents, project settings
//   ui/modals.js          new-project / macros / bibliography dialogs
//   editor/editor.js      slide editor (canvas, thumbnails, properties)
//   editor/inspector/     .gl source inspector
//   export/               HTML / PDF export
//   ui/present.js         Present mode (present/viewer.js is the slide show)
// ============================================================

import { startAutosave, flushPendingSave, whenApiReady } from './core/state.js';
import {
    bindMarkDirtyAndRender, changeGridSize, changeSlideSizePreset, syncProjectChrome,
} from './core/render.js';
import { initKeyboardShortcuts } from './core/clipboard.js';
import { initStyledSelects } from './ui/selectMenu.js';
import { loadSystemFonts } from './core/fonts.js';
import { openProjectSettings } from './ui/projectSettings.js';
import { initColorPicker } from './ui/colorPicker.js';

// Side-effectful import: each element module self-registers.
import './elements/index.js';
import { startFigureSync } from './elements/figure/figure.js';
import { initFileDrop } from './editor/fileDrop.js';
import { startTableSync } from './elements/table/table.js';
import { initUpdateNotice } from './ui/updateNotice.js';
import { showImportModal, chooseImportSource, chooseImportFolder, confirmImport, onImportNameInput } from './ui/importTalk.js';

import {
    renderEditor, renameCurrentSlide, groupSelected, ungroupSelected, enterSelectedGroup, leaveGroup,
    makeMacroFromPanel, detachSelectedMacros, editSelectedDefinition, resetSelectedOverride,
    resetSelectedInstance, gotoSelectedDefinition, styleFromSelected, manageStyles,
    editMaster, newMaster, leaveMaster, deleteEditedMaster, insertElement,
    alignSelected, distributeSelected, reorderSelected,
} from './editor/editor.js';
import { initGlInspector } from './editor/inspector/index.js';
import { projectExportHtml, projectExportPdf } from './export/index.js';
import { startPresentation } from './ui/present.js';
import {
    initRecents, openProjectFromFile, openProjectByPath, goToHome, toggleDarkMode, changeCitestyle,
} from './ui/project.js';
import {
    showNewProjectModal, validateNewProjectForm, chooseNewProjectFolder, confirmCreateProject,
    openMacrosModal, saveMacros, openBibModal, saveBib, closeModal,
} from './ui/modals.js';

// ---------- index.html wiring ----------
// Buttons carry data-action="name" (optionally data-arg); selects and
// inputs carry data-change / data-input. One delegated listener each.

const clickActions = {
    'new-project': showNewProjectModal,
    'open-project': openProjectFromFile,
    'choose-project-folder': chooseNewProjectFolder,
    'import-talk': showImportModal,
    'import-choose-source': chooseImportSource,
    'import-choose-folder': chooseImportFolder,
    'import-go': () => { if (!document.getElementById('import-go').onclick) confirmImport(); },
    'create-project': confirmCreateProject,
    'close-modal': (id) => closeModal(id),
    'open-macros': openMacrosModal,
    'open-project-settings': openProjectSettings,
    'save-macros': saveMacros,
    'open-bib': openBibModal,
    'save-bib': saveBib,
    'toggle-dark-mode': toggleDarkMode,
    'export-html': projectExportHtml,
    'export-pdf': projectExportPdf,
    'present': () => startPresentation(),
    'present-presenter': () => startPresentation({ presenter: true }),
    'go-home': goToHome,
    'group-selection': groupSelected,
    'ungroup': ungroupSelected,
    'enter-group': enterSelectedGroup,
    'exit-group': leaveGroup,
    'make-macro': makeMacroFromPanel,
    'detach-macro': detachSelectedMacros,
    'edit-macro-definition': editSelectedDefinition,
    'goto-macro-definition': gotoSelectedDefinition,
    'reset-override': resetSelectedOverride,
    'reset-instance': resetSelectedInstance,
    'style-from-element': styleFromSelected,
    'manage-styles': manageStyles,
    'edit-master': editMaster,
    'new-master': newMaster,
    'exit-master': leaveMaster,
    'delete-master': deleteEditedMaster,
    'align': alignSelected,
    'distribute': distributeSelected,
    'reorder': reorderSelected,
};

const valueActions = {
    'validate-new-project': validateNewProjectForm,
    'import-name': onImportNameInput,
    'rename-slide': renameCurrentSlide,
    'change-citestyle': changeCitestyle,
    'change-grid-size': changeGridSize,
    'change-slide-size': changeSlideSizePreset,
};

function runValueAction(attr) {
    return (e) => {
        const name = e.target.dataset && e.target.dataset[attr];
        if (name && valueActions[name]) valueActions[name](e.target.value);
    };
}

document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !clickActions[btn.dataset.action]) return;
    clickActions[btn.dataset.action](btn.dataset.arg);
});
document.addEventListener('input', runValueAction('input'));
document.addEventListener('change', runValueAction('change'));

// ---------- Startup ----------

initGlInspector();
initStyledSelects();
initColorPicker();
document.addEventListener('open-project-settings', (e) => {
    const d = e.detail || {};
    openProjectSettings(d.tab, { styleType: d.styleType, style: d.style });
});
bindMarkDirtyAndRender(renderEditor);
syncProjectChrome();
startAutosave();
initKeyboardShortcuts();

// Best effort only: the window may close before an async save finishes;
// autosave (every few seconds) is the real safety net.
window.addEventListener('beforeunload', flushPendingSave);

// The Python bridge may become ready only after this module runs
// (pywebview adds its functions asynchronously): both wait for it.
startFigureSync(); // linked figures follow their original files
startTableSync(); // linked tables follow their CSV files
initFileDrop(props => insertElement('figure', props)); // images dropped on the window
initRecents();
initUpdateNotice(); // "a new version is available" (backend/updates.py)
whenApiReady(60000).then(async api => {
    if (!api) return;
    loadSystemFonts(); // "This computer" section of the font list
    // Started by double-clicking a .gl file: open that project.
    if (typeof api.get_startup_file === 'function') {
        const res = await api.get_startup_file();
        if (res && res.path) openProjectByPath(res.path);
    }
});

// Startup finished (app.py --smoke-test checks this on built apps).
window.gluonStarted = true;
