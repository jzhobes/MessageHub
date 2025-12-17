import { useReducer, useCallback } from 'react';

type Action<T> = { type: 'SET'; field: keyof T; value: T[keyof T] } | { type: 'RESET'; initialState: T };

function formReducer<T>(state: T, action: Action<T>): T {
  switch (action.type) {
    case 'SET':
      return { ...state, [action.field]: action.value };
    case 'RESET':
      return action.initialState;
    default:
      return state;
  }
}

export function useForm<T>(initialState: T) {
  const [values, dispatch] = useReducer(formReducer<T>, initialState);

  const setField = useCallback((field: keyof T, value: T[keyof T]) => {
    dispatch({ type: 'SET', field, value });
  }, []);

  const resetForm = useCallback(() => {
    dispatch({ type: 'RESET', initialState });
  }, [initialState]);

  return {
    values,
    setField,
    resetForm,
  };
}
