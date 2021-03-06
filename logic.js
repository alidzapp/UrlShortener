/*
* Messages:
* 100: action executed successfully
* 400: couldn't add URL, most likely the vanity url is already taken
* 401: the URL isn't reachable
* 402: the "URL" parameter isn't set
* 403: the vanity string contains invalid characters
* 404: the short link doesn't exist
* 405: the vanity string can't be longer than 15 characters
* 406: the URL can't be longer than 1000 characters
* 407: the vanity string has to contain more characters
* 408: maximum number of URL's per hour exceeded
*/
var fs = require("fs");
var mysql = require("mysql");
var req = require("request");
var cons = require("./constants");
var crypto = require('crypto');
var pool = mysql.createPool({
		host:cons.host,
		user:cons.user,
		password:cons.password,
		database:cons.database
	});
var Tpl = null;

//onSuccess: the method which should be executed if the hash has been generated successfully
//onError: if there was an error, this function will be executed
//retryCount: how many times the function should check if a certain hash already exists in the database
//url: the url which should be shortened
//request / response: the request and response objects
//con: the MySQL connection
//vanity: this should be a string which represents a custom URL (e.g. "url" corresponds to d.co/url)
function generateHash(onSuccess, onError, retryCount, url, request, response, con, option) {
	var hash = "";
	if(option.vanity){
		hash = option.vanity;
		var reg = /[^A-Za-z0-9-_]/;
		//If the hash contains invalid characters or is equal to other methods ("add" or "whatis"), an error will be thrown
		if(reg.test(hash) || hash == "add" || hash == "whatis" || hash == "statis" || hash == "admin"){
			onError(response, request, con, 403);
			return;
		}
		if(hash.length > 15){
			onError(response, request, con, 405);
			return;
		}
		else if(cons.min_vanity_length > 0 && hash.length < cons.min_vanity_length){
			onError(response, request, con, 407);
			return;
		}
	}
	else{
		//This section creates a string for a short URL on basis of an SHA1 hash
		var shasum = crypto.createHash('sha1');
		shasum.update((new Date).getTime()+"");
		hash = shasum.digest('hex').substring(0, 6);
	}
	//This section query's (with a query defined in "constants.js") and looks if the short URL with the specific segment already exists
	//If the segment already exists, it will repeat the generateHash function until a segment is generated which does not exist in the database
    con.query(cons.get_query.replace("{SEGMENT}", con.escape(hash)), function(err, rows){
		if(err){
			console.log(err);
		}
        if (rows != undefined && rows.length == 0) {
            onSuccess(hash, url, request, response, con, option);
        } else {
            if (retryCount > 1 && !option.vanity) {
                generateHash(onSuccess, onError, retryCount - 1, url, request, response, con, option);
            } else {
                onError(response, request, con, 400);
            }
        }
    });
}

//The function that is executed when there's an error
//response.send sends a message back to the client
function hashError(response, request, con, code){
	response.send(urlResult(null, false, code));
}

//The function that is executed when the short URL has been created successfully.
function handleHash(hash, url, request, response, con, option){

	if( option && option.name ){
	
		con.query(
			cons.add_goods.replace("{NAME}", con.escape(option.name)).
			replace("{SEGMENT}", con.escape(hash)).
			replace("{PRICE}", con.escape(option.price)).
			replace("{THUMB}", con.escape(option.thumb))
		,
		function(err, rows){
			if(err){
				console.log(err);
			}
		});
	
	}
	
	////////////////////

	con.query(
		cons.add_query.replace("{URL}", con.escape(url)).
		replace("{SEGMENT}", con.escape(hash)).
		replace("{IP}", con.escape(getIP(request))).
		replace("{API}", request.path == '/api' ? 1 : 0 )
	,
	function(err, rows){
		if(err){
			console.log(err);
		}
	});
	response.send(urlResult(hash, true, 100));
}

//This function returns the object that will be sent to the client
function urlResult(hash, result, statusCode){
	return {
		url: hash != null ? cons.root_url + hash : null,
		result: result,
		statusCode: statusCode
	};
}

var getTab = function( id ){
	return 'stats_' + id % 10;
}

//This method looks handles a short URL and redirects to that URL if it exists
//If the short URL exists, some statistics are saved to the database
var getUrl = function(segment, request, response){
	pool.getConnection(function(err, con){

		var hash = getHash( segment );
		var port = getPort( segment );

		con.query(cons.get_query.replace("{SEGMENT}", con.escape(hash)), function(err, rows){
			var result = rows;
			if(!err && rows.length > 0){

				var referer = "";
				if( request.headers.referer ){
					referer = request.headers.referer;
					var matches = referer.match(/^https?\:\/\/([^\/?#]+)(?:[\/?#]|$)/i);
					var referer = matches && matches[1];
				}

				var ip = getIP(request);
				var url = result[0].url;
				var mobile = /(Mobile|Android|iPhone|iPad)/i.test(request.headers['user-agent']);		//是否为手机访问
				var wechat = /MicroMessenger\/([\d\.]+)/i.test(request.headers['user-agent']);			//是否在微信中
				var iPhone = /(iPhone|iPad|iPod|iOS)/i.test(request.headers['user-agent']);

				////////////////////////

				getIPInfo( ip, function( info ){

					var sql = cons.insert_view.replace( '{TABLE}', getTab( result[0].id ) );

					//console.log( info );
					con.query( sql, [ ip, result[0].id, referer, info.country, info.area, info.region, info.city, ( mobile ? 1 : 0 ) ], function(err, rows){
						if(err){
							console.log(err);
						}
						/*
						con.query(cons.update_views_query.replace("{VIEWS}", con.escape(result[0].clicks+1)).replace("{ID}", con.escape(result[0].id)), function(err, rows){
							if(err){
								console.log(err);
							}
						});
						*/
					});

				} );

				////////////////////////
				//console.log( mobile, url );

				//是手机访问
				if( port == 'm' ){
					url = url.replace('taoquan.taobao.com/coupon/unify_apply_result_tmall.htm', 'shop.m.taobao.com/shop/coupon.htm');
					url = url.replace('taoquan.taobao.com/coupon/unify_apply_result.htm', 'shop.m.taobao.com/shop/coupon.htm');
					url = url.replace('taoquan.taobao.com/coupon/unify_apply.htm', 'shop.m.taobao.com/shop/coupon.htm');
				}

				//是电脑访问
				if( port == 'p' ){
					url = url.replace('shop.m.taobao.com/shop/coupon.htm','taoquan.taobao.com/coupon/unify_apply_result_tmall.htm');
					url = url.replace('shop.m.taobao.com/shop/coupon.htm','taoquan.taobao.com/coupon/unify_apply_result.htm');
					url = url.replace('shop.m.taobao.com/shop/coupon.htm','taoquan.taobao.com/coupon/unify_apply.htm');
					url = url + ( url.indexOf('?') > -1 ? '&need_ok=true' : '' );
				}
				
				//是微信访问
				if( wechat ){
				
					if( url.indexOf('coupon') > -1 ){
						getTpl( response, Tpl + 'coupon.html', { 'url' : url } );
						
					}else{
						
						con.query(cons.get_goods.replace("{SEGMENT}", con.escape(hash)), function(err, rows){
							var result = rows;
							if(!err && rows.length > 0){
								result[0].url = url;
								result[0].platform = iPhone ? 'ios' : 'android';
								getTpl( response, Tpl + 'full.html', result[0] );								
							}
						});						
					}
					
				}else{
					response.redirect( url );
				}
				
			}
			else{
				response.send(urlResult(null, false, 404));
			}
			if(err){
				console.log(err);
			}
		});
		con.release();
	});
};

var getTpl = function( response, file, variable ){

	return fs.readFile( file, 'utf8', function( err, body ) {
		if (err) {
			return console.log(err);
		}
		
		if( variable ){
			for( var k in variable ){
				var regex = new RegExp('\{'+ k +'\}','ig');
				body = body.replace( regex, variable[k] );
			}
		}
		
		response.set('Content-Type', 'text/html');
		response.send( body );
	});
}

//This function adds attempts to add an URL to the database. If the URL returns a 404 or if there is another error, this method returns an error to the client, else an object with the newly shortened URL is sent back to the client.
var addUrl = function(url, request, response, option){

	//验证 URL 有效性
	cons.url_rule.lastIndex = 0;
	if( cons.url_rule && cons.url_rule.test( url ) == false ){
		response.send(urlResult(null, false, 403));
		return;
	}

	pool.getConnection(function(err, con){
		if(url){

			/*
			try{
				url = decodeURIComponent(url).toLowerCase();
			}catch(ex){
				url = unescape(url).toLowerCase();
			}
			*/

			var fn = function(){
				con.query(cons.check_url_query.replace("{URL}", con.escape(url)), function(err, rows){
					if(err){
						console.log(err);
					}
					if(url.indexOf("http://localhost") > -1 || url.indexOf("https://localhost") > -1){
						response.send(urlResult(null, false, 401));
						return;
					}
					if(url.length > 1000){
						response.send(urlResult(null, false, 406));
						return;
					}
					if(!err && rows.length > 0){
						response.send(urlResult(rows[0].segment, true, 100));
						return;
					}
					if( cons.url_verify ){
						req(url, function(err, res, body){
							if(res != undefined && res.statusCode == 200){
								generateHash(handleHash, hashError, 50, url, request, response, con, option);
							}
							else{
								response.send(urlResult(null, false, 401));
							}
						});
					}
					else{
						generateHash(handleHash, hashError, 50, url, request, response, con, option);
					}
				});
			};

			////////////////////////

			//不限制每小时生成数量
			if( option.vanity === false || cons.num_of_urls_per_hour == 0 ){
				fn();
			}else{

				//查询此IP最近一小时生成数量
				con.query(cons.check_ip_query.replace("{IP}", con.escape(getIP(request))), function(err, rows){
					if(err){
						console.log(err);
					}
					if(rows[0].counted != undefined && rows[0].counted < cons.num_of_urls_per_hour){
						fn();
					}else{
						response.send(urlResult(null, false, 408));
					}
				});

			}
		}
		else{
			response.send(urlResult(null, false, 402));
		}
		con.release();
	});
};

//This method looks up stats of a specific short URL and sends it to the client
var whatIs = function(url, request, response){
	pool.getConnection(function(err, con){
		//var hash = url;
		//if(!hash) hash = "";
		//hash = hash.replace(cons.root_url, "");
		var hash = getHash( url );
		con.query(cons.get_query.replace("{SEGMENT}", con.escape(hash)), function(err, rows){
			if(err || rows.length == 0){
				response.send({result: false, url: null});
			}
			else{
				response.send({result: true, url: rows[0].url, hash: hash, clicks: rows[0].clicks});
			}
		});
		con.release();
	});
};

//This method looks up stats of a specific short URL and sends it to the client
var statIs = function(url, request, response){
	pool.getConnection(function(err, con){
		//var hash = url;
		//if(!hash) hash = "";
		var hash = getHash( url );
		con.query(cons.get_statis, hash, function(err, rows){
			//console.log( JSON.stringify( rows ) );

			if(err || rows.length == 0 || rows[0].length == 0){
				response.send({result: false, url: null});
			}else{

				var res = {};
				res.result	= true;
				res.visit	= rows[0][0]['visit'];
				res.start	= rows[3][0]['start'];
				res.uv		= rows[4][0]['uv'];
				res.ip		= rows[4][0]['ip'];
				res.click	= rows[4][0]['click'];

				///////////////////
				res.referer	= {};

				for( var k in rows[1] ){
					var item = rows[1][k];
					res.referer[ item.referer ] = item.stats;
				}

				///////////////////

				res.region	= {};

				for( var k in rows[2] ){
					var item = rows[2][k];
					res.region[ item.region ] = item.stats;
				}

				response.send( res );
			}
		});
		con.release();
	});
};

var setTpl = function( dir ){
	Tpl = dir;
}

//This function returns the correct IP address. Node.js apps normally run behind a proxy, so the remoteAddress will be equal to the proxy. A proxy sends a header "X-Forwarded-For", so if this header is set, this IP address will be used.
function getIP(request){
	//return request.header("x-forwarded-for") || request.connection.remoteAddress;
	return (request.headers['x-forwarded-for'] || '').split(',')[0] || request.connection.remoteAddress;
}

/* 获取IP归属地信息 */
function getIPInfo( ip, fn ){
	//var ip = '171.41.72.243';

	var empty = { country : null, area : null, region : null, city : null };

	if( !ip || ip == '::ffff:127.0.0.1' ){
		fn && fn( empty );
		return;
	}

	var url = 'http://ip.taobao.com/service/getIpInfo.php?ip=' + ip;
	req( url, function( error, response, body ){

		if (!error && response.statusCode == 200) {
			var res = JSON.parse( body );
			if( res.code == 0 ){
				fn && fn( res.data );
				return;
			}
		}

		fn && fn( empty );
	} );
}

/* 获取真实短网址 */
function getHash( hash ){
	hash = ( hash || '' );
	hash = hash.replace( cons.root_url, '' );
	if( hash.length == 7 ){
		return hash.substr(1);
	}else{
		return hash;
	}
}

/* 获取平台信息 */
function getPort( hash ){
	if( hash.length == 7 ){
		return hash.substr(0, 1);
	}else{
		return '';
	}
}

exports.getUrl = getUrl;
exports.addUrl = addUrl;
exports.whatIs = whatIs;
exports.statIs = statIs;
exports.setTpl = setTpl;

