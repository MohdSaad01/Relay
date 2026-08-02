// Manual Jest mock for the document-picker native module.
module.exports = {
  pick: jest.fn(),
  types: { allFiles: 'allFiles' },
  errorCodes: {
    OPERATION_CANCELED: 'OPERATION_CANCELED',
    IN_PROGRESS: 'ASYNC_OP_IN_PROGRESS',
    UNABLE_TO_OPEN_FILE_TYPE: 'UNABLE_TO_OPEN_FILE_TYPE',
    NULL_PRESENTER: 'NULL_PRESENTER',
  },
  isErrorWithCode: jest.fn(err => err != null && typeof err === 'object' && 'code' in err),
};
