/**
 * Copyright 2019 The AMP HTML Authors. All Rights Reserved.
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

import {removeItem} from '#core/types/array';

import {installAmpdocServicesForInabox} from '#inabox/inabox-services';

import {AmpDocSingle} from '#service/ampdoc-impl';
import {installAmpdocServices} from '#service/core-services';

import * as Service from '../../src/service-helpers';

describes.sandboxed('amp-inabox', {}, () => {
  describes.realWin('installAmpdocServicesForInabox', {amp: false}, (env) => {
    it('should install same services for inabox', () => {
      let installedServices = [];
      const ampdoc = new AmpDocSingle(env.win);
      env.sandbox
        .stub(Service, 'registerServiceBuilderForDoc')
        .callsFake((ampdoc, id) => {
          installedServices.push(id);
        });
      env.sandbox
        .stub(Service, 'rejectServicePromiseForDoc')
        .callsFake((ampdoc, id) => {
          installedServices.push(id);
        });
      env.sandbox.stub(Service, 'getServiceForDoc').returns({});
      installAmpdocServices(ampdoc);

      const installedServicesByRegularAmp = installedServices.slice(0);
      // The inabox mode does not need the loading indicator.
      removeItem(installedServicesByRegularAmp, 'loadingIndicator');
      installedServices = [];
      installAmpdocServicesForInabox(ampdoc);
      expect(installedServices).to.deep.equal(installedServicesByRegularAmp);
    });
  });
});
