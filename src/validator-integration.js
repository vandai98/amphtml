/**
 * Copyright 2015 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {getHashParams} from '#core/types/string/url';

import {urls} from './config';
import {loadPromise} from './event-helper';
import {isModeDevelopment} from './mode';

/**
 * Triggers validation for the current document if there is a script in the
 * page that has a "development" attribute and the bypass validation via
 * #validate=0 is absent.
 *
 * @param {!Window} win Destination window for the new element.
 */
export function maybeValidate(win) {
  const filename = win.location.href;
  if (filename.startsWith('about:')) {
    // Should only happen in tests.
    return;
  }
  let validator = false;
  const params = getHashParams(win);
  if (isModeDevelopment(win, params)) {
    validator = params['validate'] !== '0';
  }

  if (validator) {
    loadScript(win.document, `${urls.cdn}/v0/validator_wasm.js`).then(() => {
      /* global amp: false */
      amp.validator.validateUrlAndLog(filename, win.document);
    });
  }
}

/**
 * Loads script
 *
 * @param {Document} doc
 * @param {string} url
 * @return {!Promise}
 */
export function loadScript(doc, url) {
  const script = /** @type {!HTMLScriptElement} */ (
    doc.createElement('script')
  );
  script.src = url;

  // Propagate nonce to all generated script tags.
  const currentScript = doc.head.querySelector('script[nonce]');
  if (currentScript) {
    script.setAttribute('nonce', currentScript.getAttribute('nonce'));
  }

  const promise = loadPromise(script).then(
    () => {
      doc.head.removeChild(script);
    },
    () => {}
  );
  doc.head.appendChild(script);
  return promise;
}
