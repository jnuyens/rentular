package com.rentular.app

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * Lets the user pick the Rentular server: rentular.com, or a self-hosted one.
 * A self-hosted server is only saved after its version endpoint answered, so a
 * typo never ends up as the stored server.
 */
class ServerSetupActivity : AppCompatActivity() {

    private lateinit var ownGroup: View
    private lateinit var input: EditText
    private lateinit var error: TextView
    private lateinit var connect: Button
    private lateinit var progress: ProgressBar
    private lateinit var useRentular: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_server_setup)
        applyEdgeToEdge(findViewById(R.id.setup_root))

        ownGroup = findViewById(R.id.setup_own_group)
        input = findViewById(R.id.setup_server_input)
        error = findViewById(R.id.setup_error)
        connect = findViewById(R.id.setup_connect)
        progress = findViewById(R.id.setup_progress)
        useRentular = findViewById(R.id.setup_use_rentular)

        ServerPrefs.origin(this)?.let { current ->
            findViewById<TextView>(R.id.setup_current).apply {
                text = getString(R.string.setup_current_server, displayHost(current))
                visibility = View.VISIBLE
            }
            if (!ServerUrl.isCanonical(current)) {
                ownGroup.visibility = View.VISIBLE
                input.setText(displayHost(current))
            }
        }

        useRentular.setOnClickListener { save(ServerUrl.CANONICAL_ORIGIN) }

        findViewById<Button>(R.id.setup_use_own).setOnClickListener {
            ownGroup.visibility = View.VISIBLE
            input.requestFocus()
        }

        connect.setOnClickListener { tryConnect() }
        input.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) {
                tryConnect()
                true
            } else {
                false
            }
        }
    }

    private fun tryConnect() {
        when (val normalized = ServerUrl.normalize(input.text.toString())) {
            is NormalizeResult.Err -> showError(
                when (normalized.reason) {
                    NormalizeError.HTTPS_REQUIRED -> R.string.setup_error_https
                    NormalizeError.INVALID -> R.string.setup_error_invalid
                }
            )
            is NormalizeResult.Ok -> {
                val origin = ServerUrl.toStoredOrigin(normalized.origin)
                setBusy(true)
                VersionClient.fetch(ServerUrl.versionUrl(origin)) { result ->
                    if (isFinishing || isDestroyed) return@fetch
                    setBusy(false)
                    when (result) {
                        is FetchResult.Ok -> save(origin)
                        FetchResult.NotFound, FetchResult.Malformed -> showError(R.string.setup_error_not_rentular)
                        FetchResult.Unreachable -> showError(R.string.setup_error_unreachable)
                    }
                }
            }
        }
    }

    private fun save(origin: String) {
        ServerPrefs.switchTo(this, origin)
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        finish()
    }

    private fun showError(messageRes: Int) {
        error.setText(messageRes)
        error.visibility = View.VISIBLE
    }

    private fun setBusy(busy: Boolean) {
        progress.visibility = if (busy) View.VISIBLE else View.GONE
        connect.isEnabled = !busy
        useRentular.isEnabled = !busy
        input.isEnabled = !busy
        if (busy) error.visibility = View.GONE
    }

    companion object {
        fun displayHost(origin: String): String = origin.removePrefix("https://")
    }
}
