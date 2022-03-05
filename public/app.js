(function (exports) {
    "use strict";
    // TODO: REMOVE BELOW
    $$('[data-id="spinner"]').forEach(function ($el) {
            $el.addEventListener('click', function (){$el.hidden = true})
        });
    // TODO: REMOVE ABOVE

    let fetch = exports.fetch || require("fetch");
    let Foo = {};
    exports.Foo = Foo;

    let accountToken = localStorage.getItem("token");
    if (accountToken) {
        console.log(`[DEBUG] accountToken: ${accountToken}`);
    }

    Foo.submit = evify(async function _fooSubmit(ev) {
        let plan = $("[name=plan]", ev.target).value;
        let email = $('[type="email"]', ev.target).value;
        let resp = await fetch(`/api/public/account/${plan}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(
                {
                    token: accountToken,
                    email: email,
                    phone: null,
                    webhook: null,
                },
                null,
                2
            ),
        });
        let json = await resp.json();
        console.log("[DEBUG] response:", json);
        if (json.token) {
            localStorage.setItem("token", json.token);
        }

        /*
        form data-id="payment-address" onsubmit="Foo.submit()" hidden>
                    <img data-id="qr-src" />
                    <br />
                    <span data-tpl="payment-address">X</span>
        */

        $(`[data-id="qr-src"]`).src = json.qr.src;
        $(`[data-tpl="payment-address"]`).innerText = json.payaddr;
        $(`[data-tpl="payment-amount"]`).innerText = json.amount;
        $$("form").forEach(function ($form) {
            $form.hidden = true;
        });
        $(`[data-id="payment-address"]`).hidden = false;

        poll(json.status_url);
    });

    async function poll(statusUrl) {
        let resp = await fetch(statusUrl, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        });
        let json = await resp.json();
        console.log("[DEBUG] poll response:", json);
        if ("pending" === json.status) {
            return await poll(statusUrl);
        }
        console.log("[DEBUG] token response:", json.access_token || json.token);

        $$('[data-id="spinner"]').forEach(function ($el) {
            $el.hidden = true;
        });
        $('[data-id="paid"]').hidden = false;
        $('[data-tpl="payment-amount"]').innerText = (
            json.amount /
            // TODO why 100M?
            (100 * 1000 * 1000)
        ).toFixed(6);
    }

    function init() {
        $(
            '[data-tpl="base-url"]'
        ).innerText = `${location.protocol}//${location.hostname}`;
    }
    init();

    function evify(fn) {
        return async function () {
            let ev = window.event;
            ev.preventDefault();
            ev.stopPropagation();
            await fn(ev).catch(function (err) {
                console.error("Fail:");
                console.error(err);
                exports.alert(err);
            });
        };
    }

    function $(sel, el) {
        return (el || document).querySelector(sel);
    }

    function $$(sel, el) {
        return (el || document).querySelectorAll(sel);
    }
})(("undefined" === typeof module && window) || exports);
