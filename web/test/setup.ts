import { configure } from '@testing-library/react';

// The first App render builds the whole world map (177 country paths); on shared CI runners that
// can take longer than Testing Library's default 1 s wait. Real failures still fail, just later.
configure({ asyncUtilTimeout: 5_000 });
