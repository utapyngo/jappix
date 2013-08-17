/*

Jappix - An open social platform
Implementation of XEP-0313: Message Archive Management

-------------------------------------------------

License: AGPL
Author: Valérian Saliou
Last revision: 04/08/13

*/


/* -- MAM Constants -- */
// Note: Internet Explorer does not support 'const'
//       We use vars as a fix...
var MAM_REQ_MAX = 50;
var MAM_SCROLL_THRESHOLD = 200;

var MAM_PREF_DEFAULTS = {
	'always' : 1,
	'never'  : 1,
	'roster' : 1
};


/* -- MAM Variables -- */
var MAM_MAP_REQS = {};
var MAM_MAP_PENDING = {};
var MAM_MAP_STATES = {};
var MAM_MSG_QUEUE = {};


/* -- MAM Configuration -- */

// Gets the MAM configuration
function getConfigMAM() {
	try {
		// Lock the archiving options
		$('#archiving').attr('disabled', true);
		
		// Get the archiving configuration
		var iq = new JSJaCIQ();
		iq.setType('get');

		iq.appendNode('prefs', { 'xmlns': NS_URN_MAM });

		con.send(iq, handleConfigMAM);
	} catch(e) {
		logThis('getConfigMAM > ' + e, 1);
	}
}

// Handles the MAM configuration
function handleConfigMAM(iq) {
	try {
		if(iq.getType() != 'error') {
			// Read packet
			var cur_default = $(iq.getNode()).find('prefs[xmlns="' + NS_URN_MAM + '"]').attr('default') || 'never';

			if(!(cur_default in MAM_PREF_DEFAULTS)) {
				cur_default = 'never';
			}

			// Apply value to options
			$('#archiving').val(cur_default);
		}

		// Unlock the archiving option
		$('#archiving').removeAttr('disabled');

		// All done.
		waitOptions('mam');
	} catch(e) {
		logThis('handleConfigMAM > ' + e, 1);
	}
}

// Sets the MAM configuration
function setConfigMAM(pref_default) {
	try {
		// Check parameters
		if(!(pref_default in MAM_PREF_DEFAULTS)) {
			pref_default = 'never';
		}

		// Send new configuration
		var iq = new JSJaCIQ();
		iq.setType('set');

		iq.appendNode('prefs', { 'xmlns': NS_URN_MAM, 'default': pref_default });

		con.send(iq);
	} catch(e) {
		logThis('setConfigMAM > ' + e, 1);
	}
}


/* -- MAM Purge -- */

// Removes all (or given) MAM archives
function purgeArchivesMAM(args) {
	try {
		if(typeof args != 'object') {
			args = {};
		}

		var iq = new JSJaCIQ();
		iq.setType('set');

		var purge = iq.appendNode('purge', { 'xmlns': NS_URN_MAM });

		for(c in args) {
			if(args[c])  purge.appendChild(iq.buildNode(c, {'xmlns': NS_URN_MAM}, args[c]));
		}
		
		con.send(iq, function(iq) {
			if(iq.getType() == 'result') {
				logThis('Archives purged (MAM).', 3);
			} else {
				logThis('Error purging archives (MAM).', 1);
			}
		});
	} catch(e) {
		logThis('purgeArchivesMAM > ' + e, 1);
	}
}


/* -- MAM Retrieval -- */

// Gets the MAM configuration
function getArchivesMAM(args, rsm_args, callback) {
	try {
		if(typeof args != 'object') {
			args = {};
		}

		var req_id = genID();

		if(args['with']) {
			MAM_MAP_PENDING[args['with']] = 1;
			MAM_MAP_REQS[req_id] = args['with'];
		}

		var iq = new JSJaCIQ();
		iq.setType('get');
		iq.setID(req_id);

		var query = iq.setQuery(NS_URN_MAM);

		for(c in args) {
			if(args[c] != null)  query.appendChild(iq.buildNode(c, {'xmlns': NS_URN_MAM}, args[c]));
		}

		if(rsm_args && typeof rsm_args == 'object') {
			var rsm_set = query.appendChild(iq.buildNode('set', {'xmlns': NS_RSM}));

			for(r in rsm_args) {
				if(rsm_args[r] != null)  rsm_set.appendChild(iq.buildNode(r, {'xmlns': NS_RSM}, rsm_args[r]));
			}
		}

		con.send(iq, function(res_iq) {
			handleArchivesMAM(res_iq, callback);
		});
	} catch(e) {
		logThis('getArchivesMAM > ' + e, 1);
	}
}

// Handles the MAM configuration
function handleArchivesMAM(iq, callback) {
	try {
		var res_id = iq.getID();
		var res_with;

		if(res_id && res_id in MAM_MAP_REQS) {
			res_with = MAM_MAP_REQS[res_id];
		}

		if(iq.getType() != 'error') {
			if(res_with) {
				var res_sel = $(iq.getQuery());
				var res_rsm_sel = res_sel.find('set[xmlns="' + NS_RSM + '"]');

				// Store that data
				MAM_MAP_STATES[res_with] = {
					'date': {
						'start': res_sel.find('start').eq(0).text(),
						'end': res_sel.find('end').eq(0).text()
					},

					'rsm': {
						'first': res_rsm_sel.find('first').eq(0).text(),
						'last': res_rsm_sel.find('last').eq(0).text(),
						'count': parseInt(res_rsm_sel.find('count').eq(0).text() || 0)
					}
				}

				// Generate stamps for easy operations
				var start_stamp = extractStamp(Date.jab2date(MAM_MAP_STATES[res_with]['date']['start']));
				var start_end = extractStamp(Date.jab2date(MAM_MAP_STATES[res_with]['date']['end']));

				// Create MAM messages target
				var target_html = '<div class="mam-chunk" data-start="' + encodeQuotes(start_stamp) + '" data-end="' + encodeQuotes(start_end) + '"></div>';
				
				var target_content_sel = $('#' + hex_md5(res_with) + ' .content');
				var target_wait_sel = target_content_sel.find('.wait-mam');

				if(target_wait_sel.size()) {
					target_wait_sel.after(target_html);
				} else {
					target_content_sel.prepend(target_html);
				}

				// Any enqueued message to display?
				if(typeof MAM_MSG_QUEUE[res_with] == 'object') {
					for(i in MAM_MSG_QUEUE[res_with]) {
						(MAM_MSG_QUEUE[res_with][i])();
					}

					delete MAM_MSG_QUEUE[res_with];
				}

				// Remove XID from pending list
				if(res_with in MAM_MAP_PENDING) {
					delete MAM_MAP_PENDING[res_with];
				}

				logThis('Got archives from: ' + res_with, 3);
			} else {
				logThis('Could not associate archive response with a known JID.', 2);
			}
		} else {
			logThis('Error handing archives (MAM).', 1);
		}

		// Execute callback?
		if(typeof callback == 'function') {
			callback(iq);
		}
	} catch(e) {
		logThis('handleArchivesMAM > ' + e, 1);
	}
}

// Handles a MAM-forwarded message stanza
function handleMessageMAM(fwd_stanza, c_delay) {
	try {
		// Build message node
		var c_message = fwd_stanza.find('message');

		if(c_message[0]) {
			// Re-build a proper JSJaC message stanza
			var message = JSJaCPacket.wrapNode(c_message[0]);

			// Check message type
			var type = message.getType() || 'chat';

			if(type == 'chat') {
				// Read message data
				var xid = bareXID(getStanzaFrom(message));
				var id = message.getID();
				var from_xid = xid;
				var b_name = getBuddyName(xid);
				var mode = (xid == getXID()) ? 'me': 'him';

				// Refactor chat XID (in case we were the sender of the archived message)
				if(mode == 'me') {
					xid = bareXID(message.getTo())
				}

				var hash = hex_md5(xid);
				var body = message.getBody();

				// Read delay (required since we deal w/ a past message!)
				var time, stamp;
				var delay = c_delay.attr('stamp');

				if(delay) {
					time = relativeDate(delay);
					stamp = extractStamp(Date.jab2date(delay));
				}
				
				// Last-minute checks before display
				if(time && stamp && body) {
					var mam_chunk_path = '#' + hash + ' .mam-chunk';

					// No chat auto-scroll?
					var no_scroll = exists(mam_chunk_path);

					// Select the custom target
					var c_target_sel = function() {
						return $(mam_chunk_path).filter(function() {
		        			return $(this).attr('data-start') <= stamp && $(this).attr('data-end') >= stamp
		        		}).filter(':first');
					};

					// Display the message in that target
					var c_msg_display = function() {
						displayMessage(type, from_xid, hash, b_name.htmlEnc(), body, time, stamp, 'old-message', true, null, mode, null, c_target_sel(), no_scroll);
					};

					// Hack: do not display the message in case we would duplicate it w/ current session messages
					//       only used when initiating a new chat, avoids collisions
					if(!(xid in MAM_MAP_STATES) && $('#' + hash).find('.one-line.user-message:last').text() == body) {
						return;
					}

					if(c_target_sel().size()) {
						// Display the message in that target
						c_msg_display();
					} else {
						// Delay display (we may not have received the MAM reply ATM)
						if(typeof MAM_MSG_QUEUE[xid] != 'object') {
							MAM_MSG_QUEUE[xid] = [];
						}

						MAM_MSG_QUEUE[xid].push(c_msg_display);
					}
				}
			}
		}
	} catch(e) {
		logThis('handleMessageMAM > ' + e, 1);
	}
}