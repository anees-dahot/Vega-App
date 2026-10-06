// The native file system is not available in Jest. Files do not exist, and
// reads and writes do nothing.
class File {
  constructor(...parts) {
    this.uri = parts.join('/');
    this.exists = false;
    this.size = 0;
  }
  static createDownloadTask() {
    return {
      state: 'idle',
      downloadAsync: async () => null,
      resumeAsync: async () => null,
      pauseAsync: async () => undefined,
      cancel: () => undefined,
      release: () => undefined,
    };
  }
  text() {
    return Promise.resolve('');
  }
  write() {}
  delete() {}
  create() {}
  info() {
    return {exists: false};
  }
}
class Directory {
  constructor(...parts) {
    this.uri = parts.join('/');
    this.exists = false;
  }
  create() {}
  delete() {}
  list() {
    return [];
  }
}
const Paths = {
  availableDiskSpace: 100 * 1024 * 1024 * 1024,
  totalDiskSpace: 128 * 1024 * 1024 * 1024,
  cache: new Directory('/cache'),
  document: new Directory('/documents'),
};

const legacy = {
  getInfoAsync: async () => ({exists: false}),
  readDirectoryAsync: async () => [],
  deleteAsync: async () => undefined,
  makeDirectoryAsync: async () => undefined,
  StorageAccessFramework: {
    readDirectoryAsync: async () => [],
    createFileAsync: async () => 'content://created',
    makeDirectoryAsync: async () => 'content://dir',
    requestDirectoryPermissionsAsync: async () => ({granted: false}),
    deleteAsync: async () => undefined,
  },
  cacheDirectory: '/cache/',
  documentDirectory: '/documents/',
};

module.exports = {__esModule: true, File, Directory, Paths, ...legacy};
