// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { startApp } from './app/core/router';

startApp().catch((error) => {
    console.error('Allama failed to start', error);
    const app = document.getElementById('app');
    if (app) {
        app.innerHTML = `
            <div class="fatal">
                <h1>Allama could not start</h1>
                <p>${String(error instanceof Error ? error.message : error)}</p>
            </div>
        `;
    }
});
