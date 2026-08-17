/**
 * @module
 * Folder Hierarchy Pages
 *
 * Architecture overview for Junior Devs:
 * Folder hierarchy components are split into focused submodules in `src/renderer/pages/folders/`.
 * This file serves as a re-export barrel to keep route definitions and imports clean.
 */

export * from './folders/useFolderRouteOptions';
export * from './folders/FolderPage';
export * from './folders/FolderSeriesPage';
export * from './folders/FolderVolumePage';
export * from './folders/FolderChapterPage';
