/**
 * Copyright 2017 The AMP HTML Authors. All Rights Reserved.
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

import {ImaPlayerData} from '#ads/google/ima/ima-player-data';

import {Deferred} from '#core/data-structures/promise';
import {dispatchCustomEvent, isJsonScriptTag, removeElement} from '#core/dom';
import {applyFillContent, isLayoutSizeDefined} from '#core/dom/layout';
import {
  observeContentSize,
  unobserveContentSize,
} from '#core/dom/layout/size-observer';
import {childElementsByTag} from '#core/dom/query';
import {PauseHelper} from '#core/dom/video/pause-helper';
import {isEnumValue, isObject} from '#core/types';
import {toArray} from '#core/types/array';
import {dict} from '#core/types/object';

import {Services} from '#service';
import {installVideoManagerForDoc} from '#service/video-manager-impl';

import {getIframe, preloadBootstrap} from '../../../src/3p-frame';
import {getConsentPolicyState} from '../../../src/consent';
import {getData, listen} from '../../../src/event-helper';
import {addUnsafeAllowAutoplay} from '../../../src/iframe-video';
import {assertHttpsUrl} from '../../../src/url';
import {VideoEvents} from '../../../src/video-interface';

/** @const */
const TAG = 'amp-ima-video';

const TYPE = 'ima-video';

/**
 * [tagName, attributes]
 *   like:
 *   ['SOURCE', {src: 'source.mp4'}]
 * @type {!Array<string, !Object>}
 */
let SerializableChildDef;

/**
 * @param {!Element} element
 * @return {!Object<string, *>}
 */
function serializeAttributes(element) {
  const {attributes} = element;
  const serialized = {};
  for (let i = 0; i < attributes.length; i++) {
    const {name, value} = attributes[i];
    serialized[name] = value;
  }
  return serialized;
}

/**
 * @implements {../../../src/video-interface.VideoInterface}
 */
class AmpImaVideo extends AMP.BaseElement {
  /** @param {!AmpElement} element */
  constructor(element) {
    super(element);

    /** @private {?Element} */
    this.iframe_ = null;

    /** @private {?../../../src/service/viewport/viewport-interface.ViewportInterface} */
    this.viewport_ = null;

    /** @private {?Promise} */
    this.playerReadyPromise_ = null;

    /** @private {?Function} */
    this.playerReadyResolver_ = null;

    /** @private {?Function} */
    this.unlistenMessage_ = null;

    /** @private {?Array<!SerializableChildDef>} */
    this.sourceChildren_ = null;

    /** @private {?string} */
    this.preconnectSource_ = null;

    /** @private {?string} */
    this.preconnectTrack_ = null;

    /** @private {boolean} */
    this.isFullscreen_ = false;

    /**
     * Maps events to their unlisteners.
     * @private {!Object<string, function()>}
     */
    this.unlisteners_ = {};

    /** @private {!ImaPlayerData} */
    this.playerData_ = new ImaPlayerData();

    this.onResized_ = this.onResized_.bind(this);

    /** @private @const */
    this.pauseHelper_ = new PauseHelper(this.element);
  }

  /** @override */
  buildCallback() {
    this.viewport_ = this.getViewport();
    if (this.element.getAttribute('data-delay-ad-request') === 'true') {
      this.unlisteners_['onFirstScroll'] = this.viewport_.onScroll(() => {
        this.sendCommand_('onFirstScroll');
      });
      // Request ads after 3 seconds, if something else doesn't trigger an ad
      // request before that.
      Services.timerFor(this.win).delay(() => {
        this.sendCommand_('onAdRequestDelayTimeout');
      }, 3000);
    }

    assertHttpsUrl(
      this.element.getAttribute('data-tag'),
      'The data-tag attribute is required for <amp-video-ima> and must be ' +
        'https'
    );

    // Handle <source> and <track> children
    const sourceElements = childElementsByTag(this.element, 'SOURCE');
    const trackElements = childElementsByTag(this.element, 'TRACK');
    const childElements = toArray(sourceElements).concat(
      toArray(trackElements)
    );

    this.sourceChildren_ = childElements.map((element) => {
      const {tagName} = element;
      const src = element.getAttribute('src');
      // Save the first source and first track to preconnect.
      if (tagName == 'SOURCE' && !this.preconnectSource_) {
        this.preconnectSource_ = src;
      } else if (tagName == 'TRACK' && !this.preconnectTrack_) {
        this.preconnectTrack_ = src;
      }
      return [tagName, serializeAttributes(element)];
    });

    // Handle IMASetting JSON
    const scriptElement = childElementsByTag(this.element, 'SCRIPT')[0];
    if (scriptElement && isJsonScriptTag(scriptElement)) {
      this.element.setAttribute(
        'data-ima-settings',
        scriptElement./*OK*/ innerHTML
      );
    }
  }

  /** @override */
  preconnectCallback() {
    const {element} = this;
    const preconnect = Services.preconnectFor(this.win);
    preconnect.preload(
      this.getAmpDoc(),
      'https://imasdk.googleapis.com/js/sdkloader/ima3.js',
      'script'
    );
    const source = element.getAttribute('data-src');
    if (source) {
      preconnect.url(this.getAmpDoc(), source);
    }
    if (this.preconnectSource_) {
      preconnect.url(this.getAmpDoc(), this.preconnectSource_);
    }
    if (this.preconnectTrack_) {
      preconnect.url(this.getAmpDoc(), this.preconnectTrack_);
    }
    preconnect.url(this.getAmpDoc(), element.getAttribute('data-tag'));
    preloadBootstrap(this.win, TYPE, this.getAmpDoc(), preconnect);
  }

  /** @override */
  isLayoutSupported(layout) {
    return isLayoutSizeDefined(layout);
  }

  /** @override */
  getConsentPolicy() {
    return null;
  }

  /** @override */
  layoutCallback() {
    const {element, win} = this;
    const consentPolicyId = super.getConsentPolicy();
    const consentPromise = consentPolicyId
      ? getConsentPolicyState(element, consentPolicyId)
      : Promise.resolve(null);
    element.setAttribute(
      'data-source-children',
      JSON.stringify(this.sourceChildren_)
    );
    return consentPromise.then((initialConsentState) => {
      const iframe = getIframe(
        win,
        element,
        TYPE,
        {initialConsentState},
        {allowFullscreen: true}
      );
      iframe.title = this.element.title || 'IMA video';

      applyFillContent(iframe);

      // This is temporary until M74 launches.
      // TODO(aghassemi, #21247)
      addUnsafeAllowAutoplay(iframe);

      this.iframe_ = iframe;

      const deferred = new Deferred();
      this.playerReadyPromise_ = deferred.promise;
      this.playerReadyResolver_ = deferred.resolve;

      this.unlistenMessage_ = listen(this.win, 'message', (e) =>
        this.handlePlayerMessage_(/** @type {!Event} */ (e))
      );

      element.appendChild(iframe);

      installVideoManagerForDoc(element);
      Services.videoManagerForDoc(element).register(this);
      observeContentSize(this.element, this.onResized_);

      return this.loadPromise(iframe).then(() => this.playerReadyPromise_);
    });
  }

  /** @override */
  unlayoutCallback() {
    if (this.iframe_) {
      removeElement(this.iframe_);
      this.iframe_ = null;
    }
    if (this.unlistenMessage_) {
      this.unlistenMessage_();
    }
    unobserveContentSize(this.element, this.onResized_);

    const deferred = new Deferred();
    this.playerReadyPromise_ = deferred.promise;
    this.playerReadyResolver_ = deferred.resolve;

    this.pauseHelper_.updatePlaying(false);

    return true;
  }

  /**
   * @param {!../layout-rect.LayoutSizeDef} size
   * @private
   */
  onResized_({height, width}) {
    if (!this.iframe_) {
      return;
    }
    this.sendCommand_('resize', {'width': width, 'height': height});
  }

  /**
   * Sends a command to the player through postMessage. NOTE: All commands sent
   * before imaVideo fires VideoEvents.LOAD will be queued until that event
   * fires.
   * @param {string} command
   * @param {Object=} opt_args
   * @private
   */
  sendCommand_(command, opt_args) {
    if (this.playerReadyPromise_) {
      this.playerReadyPromise_.then(() => {
        if (this.iframe_ && this.iframe_.contentWindow) {
          this.iframe_.contentWindow./*OK*/ postMessage(
            JSON.stringify(
              dict({
                'event': 'command',
                'func': command,
                'args': opt_args || '',
              })
            ),
            '*'
          );
        }
      });
    }
    // If we have an unlistener for this command, call it.
    if (this.unlisteners_[command]) {
      this.unlisteners_[command]();
    }
  }

  /**
   * @param {!Event} event
   * @private
   */
  handlePlayerMessage_(event) {
    if (event.source != this.iframe_.contentWindow) {
      return;
    }

    const eventData = getData(event);
    if (!isObject(eventData)) {
      return;
    }

    const videoEvent = eventData['event'];
    if (isEnumValue(VideoEvents, videoEvent)) {
      switch (videoEvent) {
        case VideoEvents.LOAD:
          this.playerReadyResolver_(this.iframe_);
          break;
        case VideoEvents.AD_START:
        case VideoEvents.PLAY:
        case VideoEvents.PLAYING:
          this.pauseHelper_.updatePlaying(true);
          break;
        case VideoEvents.PAUSE:
        case VideoEvents.ENDED:
          this.pauseHelper_.updatePlaying(false);
          break;
      }
      dispatchCustomEvent(this.element, videoEvent);
      return;
    }
    if (videoEvent == ImaPlayerData.IMA_PLAYER_DATA) {
      this.playerData_ = /** @type {!ImaPlayerData} */ (eventData['data']);
      dispatchCustomEvent(this.element, VideoEvents.LOADEDMETADATA);
      return;
    }
    if (videoEvent == 'fullscreenchange') {
      this.isFullscreen_ = !!eventData['isFullscreen'];
      return;
    }
  }

  /** @override */
  createPlaceholderCallback() {
    const {poster} = this.element.dataset;
    if (!poster) {
      return null;
    }
    const img = new Image();
    img.src = poster;
    img.setAttribute('placeholder', '');
    img.setAttribute('loading', 'lazy');
    applyFillContent(img);
    return img;
  }

  /** @override */
  pauseCallback() {
    this.pause();
  }

  // VideoInterface Implementation. See ../src/video-interface.VideoInterface

  /** @override */
  supportsPlatform() {
    return true;
  }

  /** @override */
  isInteractive() {
    return true;
  }

  /** @override */
  play(unusedIsAutoplay) {
    this.sendCommand_('play');
  }

  /** @override */
  pause() {
    this.sendCommand_('pause');
  }

  /** @override */
  mute() {
    this.sendCommand_('mute');
  }

  /** @override */
  unmute() {
    this.sendCommand_('unmute');
  }

  /** @override */
  showControls() {
    this.sendCommand_('showControls');
  }

  /** @override */
  hideControls() {
    this.sendCommand_('hideControls');
  }

  /** @override */
  fullscreenEnter() {
    this.sendCommand_('requestFullscreen');
  }

  /** @override */
  fullscreenExit() {
    this.sendCommand_('exitFullscreen');
  }

  /** @override */
  isFullscreen() {
    return this.isFullscreen_;
  }

  /** @override */
  getMetadata() {
    // Not implemented
  }

  /** @override */
  preimplementsMediaSessionAPI() {
    return false;
  }

  /** @override */
  preimplementsAutoFullscreen() {
    return false;
  }

  /** @override */
  getCurrentTime() {
    return this.playerData_.currentTime;
  }

  /** @override */
  getDuration() {
    return this.playerData_.duration;
  }

  /** @override */
  getPlayedRanges() {
    return this.playerData_.playedRanges;
  }

  /** @override */
  seekTo(unusedTimeSeconds) {
    this.user().error(TAG, '`seekTo` not supported.');
  }
}

AMP.extension(TAG, '0.1', (AMP) => {
  AMP.registerElement(TAG, AmpImaVideo);
});
