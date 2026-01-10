import { UIManager } from './ui.js';
import { SettingsManager } from './settings.js';
import { LogicManager } from './logic.js';

document.addEventListener('DOMContentLoaded', () => {
  UIManager.init();
  SettingsManager.init();
  LogicManager.init();

  console.log('WeebCentral Extension Modular UI Initialized');
});
