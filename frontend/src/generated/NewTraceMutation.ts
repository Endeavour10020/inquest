/* tslint:disable */
/* eslint-disable */
// @generated
// This file was automatically generated and should not be edited.

// ====================================================
// GraphQL mutation operation: NewTraceMutation
// ====================================================

export interface NewTraceMutation_newTrace_currentFailures {
  __typename: "TraceFailure";
  message: string;
}

export interface NewTraceMutation_newTrace {
  __typename: "Trace";
  id: string;
  statement: string;
  active: boolean;
  version: number;
  currentFailures: NewTraceMutation_newTrace_currentFailures[];
}

export interface NewTraceMutation {
  newTrace: NewTraceMutation_newTrace;
}

export interface NewTraceMutationVariables {
  module: string;
  function: string;
  statement: string;
  key: string;
}
