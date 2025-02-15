/**
 * Copyright 2018 The AMP HTML Authors. All Rights Reserved.
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

import {Deferred} from '#core/data-structures/promise';
import {createElementWithAttributes} from '#core/dom';

import {getA4AId, registerIniLoadListener} from '#inabox/utils';

import {Services} from '#service';

import * as IniLoad from '../../../src/ini-load';

describes.realWin('inabox-utils', {}, (env) => {
  let dispatchEventStub;
  let parentPostMessageStub;
  let initCustomEventStub;
  let ampdoc;
  let a4aIdMetaElement;
  let iniLoadDeferred;

  function addA4AMetaTagToDocument() {
    a4aIdMetaElement = createElementWithAttributes(env.win.document, 'meta', {
      name: 'amp4ads-id',
      content: 'vendor=doubleclick,type=impression-id,value=12345',
    });
    env.win.document.head.appendChild(a4aIdMetaElement);
  }

  beforeEach(() => {
    ampdoc = {win: env.win, getRootNode: () => ({})};
    iniLoadDeferred = new Deferred();

    env.sandbox
      .stub(IniLoad, 'whenContentIniLoadMeasure')
      .returns(iniLoadDeferred.promise);
    env.sandbox
      .stub(Services, 'viewportForDoc')
      .withArgs(ampdoc)
      .returns({getLayoutRect: () => ({})});
    parentPostMessageStub = env.sandbox.stub();
    dispatchEventStub = env.sandbox.stub();
    initCustomEventStub = env.sandbox.stub();
    env.win.parent = {postMessage: parentPostMessageStub};
    env.win.CustomEvent = (type, eventInit) => {
      initCustomEventStub(type, eventInit);
    };
    env.win.document.createEvent = () => ({
      initCustomEvent: initCustomEventStub,
    });
    env.win.dispatchEvent = dispatchEventStub;
  });

  it('should fire custom event and postMessage', () => {
    registerIniLoadListener(ampdoc);
    expect(dispatchEventStub).to.not.be.called;
    expect(parentPostMessageStub).to.not.be.called;
    iniLoadDeferred.resolve([]);
    const timeDeferred = new Deferred();
    setTimeout(() => timeDeferred.resolve(), 10);
    return timeDeferred.promise.then(() => {
      expect(dispatchEventStub).to.be.calledOnce;
      expect(initCustomEventStub).to.be.calledWith('amp-ini-load');
      expect(parentPostMessageStub).to.be.calledWith('amp-ini-load', '*');
    });
  });

  it('Should not return an a4aId if no a4a meta tag in head', () => {
    expect(getA4AId(env.win)).to.be.not.ok;
  });

  it('Should be able to get the a4aId if on the document', () => {
    addA4AMetaTagToDocument();
    expect(getA4AId(env.win)).to.be.ok;
  });
});
